package deployments

import (
	"fmt"
	"hash/fnv"
	"path"
	"regexp"
	"sort"
	"strings"

	"deploy-manager/internal/connectors"
	"deploy-manager/internal/db"
	"deploy-manager/internal/stringutil"
)

type remoteStep struct {
	label          string
	command        string
	input          string
	resolvesCommit bool
}

type remoteStepOptions struct {
	targetColor               string
	imageRef                  string
	bluePort                  string
	greenPort                 string
	portVariables             []composePortVariable
	serviceVariables          map[string][]connectors.RuntimeVariable
	sourceAuthorizationHeader string
}

type composePortVariable struct {
	name          string
	bluePort      string
	greenPort     string
	serviceName   string
	containerPort int32
}

const (
	maxRuntimeVariableValueLength = 8192
	maxRuntimeEnvFileLength       = 65536
	maxComposeProjectSlugLength   = 48
)

func remoteSteps(target db.GetDeploymentTargetRow, variables []connectors.RuntimeVariable, options ...remoteStepOptions) ([]remoteStep, error) {
	if err := validateRemoteTarget(target); err != nil {
		return nil, err
	}
	stepOptions := resolveRemoteStepOptions(target, options)
	if stepOptions.imageRef != "" {
		generated := appendArtifactVariables(nil, target, stepOptions)
		variables = mergeRuntimeVariables(variables, generated)
		for service, scoped := range stepOptions.serviceVariables {
			stepOptions.serviceVariables[service] = mergeRuntimeVariables(scoped, generated)
		}
	}

	remoteDir := stringutil.ShellQuote(target.RemoteDirectory)
	steps := []remoteStep{
		{
			label:   "Preparing remote directory",
			command: fmt.Sprintf("mkdir -p %s", remoteDir),
		},
	}

	if isSourceDeployWithOptions(target, stepOptions) {
		repository := stringutil.ShellQuote(target.RepositoryUrl.String)
		branch := stringutil.ShellQuote(target.Branch)
		gitCommands, err := sourceGitCommands(remoteDir, stepOptions.sourceAuthorizationHeader)
		if err != nil {
			return nil, err
		}
		commitCheckout, err := gitCommitCheckout(remoteDir, deploymentCommit(target))
		if err != nil {
			return nil, err
		}
		syncCommand := fmt.Sprintf(
			"if [ -d %[1]s/.git ]; then cd %[1]s && %[5]s fetch --prune origin %[2]s && git -c safe.directory=%[1]s reset --hard && git -c safe.directory=%[1]s checkout %[2]s && git -c safe.directory=%[1]s reset --hard origin/%[2]s; else find %[1]s -mindepth 1 -maxdepth 1 -exec rm -rf {} + && %[6]s clone --branch %[2]s %[3]s %[1]s; fi%[4]s",
			remoteDir,
			branch,
			repository,
			commitCheckout,
			gitCommands.fetch,
			gitCommands.clone,
		)
		steps = append(steps, remoteStep{
			label:          "Syncing repository",
			command:        gitCommands.prefix + syncCommand + gitCommands.suffix,
			input:          gitCommands.input,
			resolvesCommit: true,
		})
	}

	envFile, err := renderRuntimeEnvFile(variables)
	if err != nil {
		return nil, err
	}
	envPath := path.Join(path.Dir(target.ComposePath), ".env")
	steps = append(steps, remoteStep{
		label:   "Writing runtime environment",
		command: fmt.Sprintf("cd %s && umask 077 && printf %%s %s > %s", remoteDir, stringutil.ShellQuote(envFile), stringutil.ShellQuote(envPath)),
	})
	serviceSteps, err := serviceRuntimeSteps(target, stepOptions.serviceVariables, stepOptions.portVariables)
	if err != nil {
		return nil, err
	}
	steps = append(steps, serviceSteps...)

	if target.Strategy == "blue_green" {
		steps = append(steps, blueGreenSteps(target, stepOptions)...)
	} else {
		project := stringutil.ShellQuote(projectSlug(target.ApplicationName))
		composeFiles := composeFileArguments(target.ComposePath, stepOptions.serviceVariables, stepOptions.portVariables)
		steps = append(steps, composeConfigStep(remoteDir, composeFiles))
		if isSourceDeployWithOptions(target, stepOptions) {
			steps = append(steps, remoteStep{
				label:   "Building compose images",
				command: fmt.Sprintf("cd %s && COMPOSE_PROJECT_NAME=%s docker compose %s build --pull", remoteDir, project, composeFiles),
			})
		} else {
			steps = append(steps, remoteStep{
				label:   "Pulling compose images",
				command: fmt.Sprintf("cd %s && COMPOSE_PROJECT_NAME=%s docker compose %s pull", remoteDir, project, composeFiles),
			})
		}
		steps = append(steps, remoteStep{
			label:   "Starting compose stack",
			command: fmt.Sprintf("cd %s && COMPOSE_PROJECT_NAME=%s docker compose %s up -d --remove-orphans", remoteDir, project, composeFiles),
		})
	}

	return steps, nil
}

func serviceRuntimeSteps(target db.GetDeploymentTargetRow, services map[string][]connectors.RuntimeVariable, ports []composePortVariable) ([]remoteStep, error) {
	managedPorts := make(map[string][]composePortVariable)
	for _, port := range ports {
		if port.serviceName != "" {
			managedPorts[port.serviceName] = append(managedPorts[port.serviceName], port)
		}
	}
	if len(services) == 0 && len(managedPorts) == 0 {
		return nil, nil
	}
	composeDirectory := path.Dir(target.ComposePath)
	runtimeDirectory := path.Join(composeDirectory, ".deploy-manager")
	remoteDir := stringutil.ShellQuote(target.RemoteDirectory)
	names := make([]string, 0, len(services)+len(managedPorts))
	for name := range services {
		if !composeServiceNamePattern.MatchString(name) {
			return nil, fmt.Errorf("compose service runtime target %q is invalid", name)
		}
		names = append(names, name)
	}
	for name := range managedPorts {
		if !composeServiceNamePattern.MatchString(name) {
			return nil, fmt.Errorf("compose service port target %q is invalid", name)
		}
		if _, ok := services[name]; !ok {
			names = append(names, name)
		}
	}
	sort.Strings(names)

	steps := make([]remoteStep, 0, len(names)+1)
	var override strings.Builder
	bindHost := "127.0.0.1"
	if strings.TrimSpace(target.Hostname) == "playground" {
		bindHost = "0.0.0.0"
	}
	override.WriteString("services:\n")
	for _, name := range names {
		override.WriteString("  " + name + ":\n")
		if variables, ok := services[name]; ok {
			envFile, err := renderRuntimeEnvFile(variables)
			if err != nil {
				return nil, fmt.Errorf("render runtime variables for compose service %s: %w", name, err)
			}
			envPath := path.Join(runtimeDirectory, name+".env")
			steps = append(steps, remoteStep{
				label:   "Writing runtime environment for " + name,
				command: fmt.Sprintf("cd %s && umask 077 && mkdir -p %s && printf %%s %s > %s", remoteDir, stringutil.ShellQuote(runtimeDirectory), stringutil.ShellQuote(envFile), stringutil.ShellQuote(envPath)),
			})
			override.WriteString("    env_file:\n      - .deploy-manager/" + name + ".env\n")
		}
		if bindings := managedPorts[name]; len(bindings) > 0 {
			sort.Slice(bindings, func(i, j int) bool { return bindings[i].containerPort < bindings[j].containerPort })
			override.WriteString("    ports: !override\n")
			for _, binding := range bindings {
				override.WriteString(fmt.Sprintf("      - \"%s:${%s:?%s is required}:%d\"\n", bindHost, binding.name, binding.name, binding.containerPort))
			}
		}
	}
	overridePath := runtimeComposePath(target.ComposePath)
	steps = append(steps, remoteStep{
		label:   "Writing compose runtime override",
		command: fmt.Sprintf("cd %s && umask 077 && printf %%s %s > %s", remoteDir, stringutil.ShellQuote(override.String()), stringutil.ShellQuote(overridePath)),
	})
	return steps, nil
}

func runtimeComposePath(composePath string) string {
	return path.Join(path.Dir(composePath), ".deploy-manager.runtime.yml")
}

func composeFileArguments(composePath string, services map[string][]connectors.RuntimeVariable, ports []composePortVariable) string {
	arguments := "-f " + stringutil.ShellQuote(composePath)
	if len(services) > 0 || hasManagedComposePorts(ports) {
		arguments += " -f " + stringutil.ShellQuote(runtimeComposePath(composePath))
	}
	return arguments
}

func hasManagedComposePorts(ports []composePortVariable) bool {
	for _, port := range ports {
		if port.serviceName != "" {
			return true
		}
	}
	return false
}

type sourceGitCommandSet struct {
	prefix string
	fetch  string
	clone  string
	suffix string
	input  string
}

func sourceGitCommands(remoteDir string, authorizationHeader string) (sourceGitCommandSet, error) {
	commands := sourceGitCommandSet{fetch: "git -c safe.directory=" + remoteDir, clone: "git"}
	authorizationHeader = strings.TrimSpace(authorizationHeader)
	if authorizationHeader == "" {
		return commands, nil
	}
	if len(authorizationHeader) > 4096 || stringutil.HasControlCharacter(authorizationHeader) {
		return sourceGitCommandSet{}, fmt.Errorf("source authorization header is invalid")
	}
	commands.prefix = "IFS= read -r GIT_CONFIG_VALUE_0; export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.extraHeader GIT_CONFIG_VALUE_0 GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0; "
	commands.input = authorizationHeader + "\n"
	return commands, nil
}

// isSourceDeploy reports whether the image must be built from the synced
// repository on the target (no pinned image_ref) rather than pulled from a
// registry. Building on the target keeps Phase 1 free of registry and
// ephemeral-builder infrastructure.
func isSourceDeploy(target db.GetDeploymentTargetRow) bool {
	if deploymentImageRef(target) != "" {
		return false
	}
	return target.RepositoryUrl.Valid && strings.TrimSpace(target.RepositoryUrl.String) != ""
}

func isSourceDeployWithOptions(target db.GetDeploymentTargetRow, options remoteStepOptions) bool {
	return strings.TrimSpace(options.imageRef) == "" && isSourceDeploy(target)
}

func resolveRemoteStepOptions(target db.GetDeploymentTargetRow, options []remoteStepOptions) remoteStepOptions {
	if len(options) > 0 {
		resolved := options[0]
		if resolved.imageRef == "" {
			resolved.imageRef = deploymentImageRef(target)
		}
		return resolved
	}
	return remoteStepOptions{imageRef: deploymentImageRef(target)}
}

func appendArtifactVariables(variables []connectors.RuntimeVariable, target db.GetDeploymentTargetRow, options remoteStepOptions) []connectors.RuntimeVariable {
	next := make([]connectors.RuntimeVariable, 0, len(variables)+4)
	next = append(next, variables...)
	next = append(next, connectors.RuntimeVariable{Key: "DEPLOY_IMAGE", Value: options.imageRef})
	if tag := imageTag(options.imageRef); tag != "" {
		next = append(next, connectors.RuntimeVariable{Key: "DEPLOY_IMAGE_TAG", Value: tag})
		if key := applicationImageTagKey(target.ApplicationName); key != "" {
			next = append(next, connectors.RuntimeVariable{Key: key, Value: tag})
		}
	}
	if options.targetColor != "" {
		next = append(next, connectors.RuntimeVariable{Key: "DEPLOY_COLOR", Value: options.targetColor})
	}
	return next
}

func imageTag(imageRef string) string {
	imageRef = strings.TrimSpace(imageRef)
	if imageRef == "" || strings.Contains(imageRef, "@sha256:") {
		return ""
	}
	lastSlash := strings.LastIndex(imageRef, "/")
	lastColon := strings.LastIndex(imageRef, ":")
	if lastColon <= lastSlash || lastColon == len(imageRef)-1 {
		return ""
	}
	return imageRef[lastColon+1:]
}

func applicationImageTagKey(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return ""
	}
	var builder strings.Builder
	lastUnderscore := false
	for _, char := range strings.ToUpper(name) {
		if (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') {
			builder.WriteRune(char)
			lastUnderscore = false
			continue
		}
		if !lastUnderscore && builder.Len() > 0 {
			builder.WriteByte('_')
			lastUnderscore = true
		}
	}
	key := strings.Trim(builder.String(), "_")
	if key == "" {
		return ""
	}
	return key + "_IMAGE_TAG"
}

func validateRemoteTarget(target db.GetDeploymentTargetRow) error {
	remoteDir := strings.TrimSpace(target.RemoteDirectory)
	if remoteDir == "" {
		return fmt.Errorf("remote_directory is required")
	}
	if !path.IsAbs(remoteDir) {
		return fmt.Errorf("remote_directory must be an absolute path")
	}
	if path.Clean(remoteDir) == "/" {
		return fmt.Errorf("remote_directory cannot be root")
	}
	if stringutil.HasControlCharacter(remoteDir) {
		return fmt.Errorf("remote_directory cannot contain control characters")
	}
	if strings.Contains(remoteDir, "//") {
		return fmt.Errorf("remote_directory cannot contain empty path segments")
	}
	for _, segment := range strings.Split(remoteDir, "/") {
		if segment == ".." {
			return fmt.Errorf("remote_directory cannot contain parent directory segments")
		}
	}
	if strings.TrimSpace(target.ComposePath) == "" {
		return fmt.Errorf("compose_path is required")
	}
	if err := ValidateComposePath(target.ComposePath); err != nil {
		return err
	}
	if target.RepositoryUrl.Valid && strings.TrimSpace(target.RepositoryUrl.String) != "" {
		if err := ValidateGitRefName(target.Branch); err != nil {
			return err
		}
	}
	if !validRemoteStrategy(target.Strategy) {
		return fmt.Errorf("deployment strategy must be rolling or blue_green")
	}
	if strings.TrimSpace(target.Strategy) == "blue_green" {
		healthCheckURL := strings.TrimSpace(target.HealthCheckUrl.String)
		if !target.HealthCheckUrl.Valid || healthCheckURL == "" {
			return fmt.Errorf("blue_green deployments require a health_check_url")
		}
		if !strings.Contains(healthCheckURL, "{color}") {
			return fmt.Errorf("blue_green health_check_url must include {color}")
		}
	}
	return nil
}

func validRemoteStrategy(strategy string) bool {
	strategy = strings.TrimSpace(strategy)
	return strategy == "" || strategy == "rolling" || strategy == "blue_green"
}

func ValidateComposePath(composePath string) error {
	composePath = strings.TrimSpace(composePath)
	if composePath == "" {
		return fmt.Errorf("compose_path is required")
	}
	if path.IsAbs(composePath) {
		return fmt.Errorf("compose_path must be relative to remote_directory")
	}
	if stringutil.HasControlCharacter(composePath) {
		return fmt.Errorf("compose_path cannot contain control characters")
	}
	for _, segment := range strings.Split(composePath, "/") {
		if segment == ".." {
			return fmt.Errorf("compose_path cannot traverse parent directories")
		}
	}
	if path.Clean(composePath) == "." {
		return fmt.Errorf("compose_path must point to a compose file")
	}
	return nil
}

func ValidateGitRefName(value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return fmt.Errorf("branch is required")
	}
	if strings.HasPrefix(value, "-") {
		return fmt.Errorf("branch cannot start with hyphen")
	}
	if strings.HasPrefix(value, "/") || strings.HasSuffix(value, "/") || strings.Contains(value, "//") {
		return fmt.Errorf("branch cannot contain empty path segments")
	}
	if strings.HasSuffix(value, ".") || strings.Contains(value, "..") || strings.Contains(value, "@{") || strings.HasSuffix(value, ".lock") {
		return fmt.Errorf("branch is not a safe git ref")
	}
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') {
			continue
		}
		switch char {
		case '/', '.', '_', '-':
			continue
		default:
			return fmt.Errorf("branch contains unsupported characters")
		}
	}
	return nil
}

func blueGreenSteps(target db.GetDeploymentTargetRow, options remoteStepOptions) []remoteStep {
	remoteDir := stringutil.ShellQuote(target.RemoteDirectory)
	composeFiles := composeFileArguments(target.ComposePath, options.serviceVariables, options.portVariables)
	project := stringutil.ShellQuote(projectSlug(target.ApplicationName))
	targetColor := stringutil.ShellQuote(defaultTargetColor(options.targetColor))
	composeCommand := func(action string) string {
		return fmt.Sprintf(
			"cd %s && color=$(cat .deploy-manager-next-color) && port=$(%s) && COMPOSE_PROJECT_NAME=%s-$color DEPLOY_COLOR=$color DEPLOY_PORT=$port%s docker compose %s %s",
			remoteDir,
			colorPortCommand(options),
			project,
			composePortVariableAssignments(options.portVariables),
			composeFiles,
			action,
		)
	}

	steps := []remoteStep{
		{
			label:   "Selecting blue-green target",
			command: fmt.Sprintf("cd %s && printf %%s %s > .deploy-manager-next-color", remoteDir, targetColor),
		},
		{
			label:   "Validating compose config",
			command: composeCommand("config --quiet"),
		},
	}
	if isSourceDeployWithOptions(target, options) {
		steps = append(steps, remoteStep{
			label:   "Building next color images",
			command: composeCommand("build --pull"),
		})
	} else {
		steps = append(steps, remoteStep{
			label:   "Pulling next color images",
			command: composeCommand("pull"),
		})
	}
	steps = append(steps, remoteStep{
		label:   "Starting next color stack",
		command: composeCommand("up -d --remove-orphans"),
	})
	steps = append(steps, remoteStep{
		label:   "Checking next color health",
		command: fmt.Sprintf("cd %s && color=$(cat .deploy-manager-next-color) && port=$(%s) && url=$(printf %%s %s | sed \"s/{color}/$color/g\" | sed \"s/{port}/$port/g\") && curl -fsS --retry 10 --retry-delay 2 --retry-all-errors \"$url\" >/dev/null", remoteDir, colorPortCommand(options), stringutil.ShellQuote(deploymentHealthCheckURL(target, target.HealthCheckUrl.String))),
	})
	return steps
}

func composePortVariableAssignments(variables []composePortVariable) string {
	assignments := make([]string, 0, len(variables))
	for _, variable := range variables {
		if variable.name == "DEPLOY_PORT" || !connectors.ValidRuntimeVariableKey(variable.name) {
			continue
		}
		assignments = append(assignments, fmt.Sprintf(" %s=$(%s)", variable.name, fixedColorPortCommand(variable.bluePort, variable.greenPort)))
	}
	return strings.Join(assignments, "")
}

func colorPortCommand(options remoteStepOptions) string {
	return colorPortPairCommand(options.bluePort, options.greenPort)
}

func colorPortPairCommand(bluePort string, greenPort string) string {
	bluePort = strings.TrimSpace(bluePort)
	if bluePort == "" {
		bluePort = "3101"
	}
	greenPort = strings.TrimSpace(greenPort)
	if greenPort == "" {
		greenPort = "3102"
	}
	return fmt.Sprintf("if [ \"$color\" = \"blue\" ]; then printf %%s \"${BLUE_DEPLOY_PORT:-%s}\"; else printf %%s \"${GREEN_DEPLOY_PORT:-%s}\"; fi", bluePort, greenPort)
}

func fixedColorPortCommand(bluePort string, greenPort string) string {
	return fmt.Sprintf("if [ \"$color\" = \"blue\" ]; then printf %%s %s; else printf %%s %s; fi", stringutil.ShellQuote(bluePort), stringutil.ShellQuote(greenPort))
}

func defaultTargetColor(color string) string {
	color = strings.TrimSpace(color)
	if color == "green" {
		return "green"
	}
	return "blue"
}

func composeConfigStep(remoteDir string, composeFiles string) remoteStep {
	return remoteStep{
		label:   "Validating compose config",
		command: fmt.Sprintf("cd %s && docker compose %s config --quiet", remoteDir, composeFiles),
	}
}

// BuildComposeDownCommand stops every project name an application may have
// used across rolling and blue-green deployments. Volumes are preserved.
func BuildComposeDownCommand(application db.Application, routes []db.ListProxyRouteTargetsForApplicationRow) (string, error) {
	target := db.GetDeploymentTargetRow{
		ApplicationID:   application.ID,
		ApplicationName: application.Name,
		RepositoryUrl:   application.RepositoryUrl,
		Branch:          application.Branch,
		ComposePath:     application.ComposePath,
		RemoteDirectory: application.RemoteDirectory,
	}
	if err := validateRemoteTarget(target); err != nil {
		return "", err
	}

	remoteDir := stringutil.ShellQuote(application.RemoteDirectory)
	composePath := stringutil.ShellQuote(application.ComposePath)
	project := projectSlug(application.Name)
	ports, err := routePorts(routes)
	if err != nil {
		return "", err
	}
	down := func(name string, color string, port string) string {
		return fmt.Sprintf(
			"COMPOSE_PROJECT_NAME=%s DEPLOY_COLOR=%s DEPLOY_PORT=%s%s docker compose -f %s down --remove-orphans",
			stringutil.ShellQuote(name),
			stringutil.ShellQuote(color),
			stringutil.ShellQuote(port),
			composePortVariableValues(ports.variables, color),
			composePath,
		)
	}
	commands := []string{
		down(project, "blue", ports.blue),
		down(project+"-blue", "blue", ports.blue),
		down(project+"-green", "green", ports.green),
	}
	return fmt.Sprintf(
		"test -d %s && cd %s && test -f %s && %s",
		remoteDir,
		remoteDir,
		composePath,
		strings.Join(commands, " && "),
	), nil
}

func composePortVariableValues(variables []composePortVariable, color string) string {
	assignments := make([]string, 0, len(variables))
	for _, variable := range variables {
		if variable.name == "DEPLOY_PORT" || !connectors.ValidRuntimeVariableKey(variable.name) {
			continue
		}
		port := variable.bluePort
		if color == "green" {
			port = variable.greenPort
		}
		assignments = append(assignments, fmt.Sprintf(" %s=%s", variable.name, stringutil.ShellQuote(port)))
	}
	return strings.Join(assignments, "")
}

func routePorts(routes []db.ListProxyRouteTargetsForApplicationRow) (blueGreenPorts, error) {
	ports := blueGreenPorts{}
	seen := map[string]composePortVariable{}
	for _, route := range routes {
		blue := upstreamPort(route.BlueUpstreamUrl)
		green := upstreamPort(route.GreenUpstreamUrl)
		if blue == "" && green == "" {
			continue
		}
		if blue == "" {
			blue = "3101"
		}
		if green == "" {
			green = "3102"
		}

		name := strings.TrimSpace(route.PortVariable.String)
		if route.PortVariable.Valid && !connectors.ValidRuntimeVariableKey(name) {
			return blueGreenPorts{}, fmt.Errorf("proxy route port variable %q is invalid", name)
		}
		if ports.blue == "" || name == "DEPLOY_PORT" {
			ports.blue, ports.green = blue, green
		}
		variable := composePortVariable{name: name, bluePort: blue, greenPort: green}
		if name == "" && route.ComposeService.Valid && route.ContainerPort.Valid {
			variable.name = managedComposePortName(route.ComposeService.String, route.ContainerPort.Int32)
			variable.serviceName = route.ComposeService.String
			variable.containerPort = route.ContainerPort.Int32
			name = variable.name
		}
		if name == "" {
			continue
		}
		if existing, ok := seen[name]; ok {
			if existing.bluePort != blue || existing.greenPort != green {
				return blueGreenPorts{}, fmt.Errorf("proxy route port variable %s has conflicting port pairs", name)
			}
			continue
		}
		seen[name] = variable
	}
	if ports.blue == "" {
		ports.blue, ports.green = "3101", "3102"
	}
	for _, variable := range seen {
		ports.variables = append(ports.variables, variable)
	}
	sort.Slice(ports.variables, func(i int, j int) bool { return ports.variables[i].name < ports.variables[j].name })
	return ports, nil
}

func managedComposePortName(service string, port int32) string {
	var name strings.Builder
	for _, char := range strings.ToUpper(service) {
		if (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') {
			name.WriteRune(char)
		} else {
			name.WriteByte('_')
		}
		if name.Len() == 48 {
			break
		}
	}
	return fmt.Sprintf("DEPLOY_MANAGER_%s_%d_%08X_PORT", strings.Trim(name.String(), "_"), port, hashProjectName(service))
}

var projectSlugPattern = regexp.MustCompile(`[^a-z0-9]+`)
var composeServiceNamePattern = regexp.MustCompile(`^[A-Za-z0-9_.-]+$`)

func projectSlug(value string) string {
	original := value
	value = strings.ToLower(strings.TrimSpace(value))
	value = projectSlugPattern.ReplaceAllString(value, "-")
	value = strings.Trim(value, "-")
	if value == "" {
		return "deploy-manager-app"
	}
	if len(value) > maxComposeProjectSlugLength {
		suffix := fmt.Sprintf("%08x", hashProjectName(original))
		prefix := strings.Trim(value[:maxComposeProjectSlugLength-len(suffix)-1], "-")
		if prefix == "" {
			return suffix
		}
		return prefix + "-" + suffix
	}
	return value
}

func hashProjectName(value string) uint32 {
	hash := fnv.New32a()
	_, _ = hash.Write([]byte(value))
	return hash.Sum32()
}

func renderEnvFile(variables []connectors.RuntimeVariable) string {
	var lines []string
	for _, variable := range variables {
		if !isValidRuntimeVariable(variable) {
			continue
		}
		lines = append(lines, fmt.Sprintf("%s=%s", variable.Key, quoteEnvValue(variable.Value)))
	}
	sort.Strings(lines)
	if len(lines) == 0 {
		return ""
	}
	return strings.Join(lines, "\n") + "\n"
}

func renderRuntimeEnvFile(variables []connectors.RuntimeVariable) (string, error) {
	for _, variable := range variables {
		if err := validateRuntimeVariable(variable); err != nil {
			return "", err
		}
	}
	envFile := renderEnvFile(variables)
	if len(envFile) > maxRuntimeEnvFileLength {
		return "", fmt.Errorf("runtime environment cannot exceed %d bytes", maxRuntimeEnvFileLength)
	}
	return envFile, nil
}

func validateRuntimeVariable(variable connectors.RuntimeVariable) error {
	if !connectors.ValidRuntimeVariableKey(variable.Key) {
		return nil
	}
	if strings.ContainsRune(variable.Value, '\x00') {
		return fmt.Errorf("runtime variable %s cannot contain null bytes", variable.Key)
	}
	if len(variable.Value) > maxRuntimeVariableValueLength {
		return fmt.Errorf("runtime variable %s cannot exceed %d bytes", variable.Key, maxRuntimeVariableValueLength)
	}
	return nil
}

func validRuntimeVariableCount(variables []connectors.RuntimeVariable) int {
	count := 0
	for _, variable := range variables {
		if isValidRuntimeVariable(variable) {
			count++
		}
	}
	return count
}

func isValidRuntimeVariable(variable connectors.RuntimeVariable) bool {
	return connectors.ValidRuntimeVariableKey(variable.Key)
}

func gitCommitCheckout(remoteDir string, commit string) (string, error) {
	commit = strings.TrimSpace(commit)
	if commit == "" {
		return "", nil
	}
	if !ValidCommitSHA(commit) {
		return "", fmt.Errorf("commit_sha must be a 7 to 40 character hexadecimal SHA")
	}
	return fmt.Sprintf(" && cd %[1]s && git -c safe.directory=%[1]s checkout --detach %s", remoteDir, stringutil.ShellQuote(commit)), nil
}

var gitCommitSHAPattern = regexp.MustCompile(`^[0-9a-fA-F]{7,40}$`)

func ValidCommitSHA(value string) bool {
	return gitCommitSHAPattern.MatchString(strings.TrimSpace(value))
}

func deploymentCommit(target db.GetDeploymentTargetRow) string {
	if !target.CommitSha.Valid {
		return ""
	}
	return target.CommitSha.String
}

func deploymentImageRef(target db.GetDeploymentTargetRow) string {
	if !target.ImageRef.Valid {
		return ""
	}
	return strings.TrimSpace(target.ImageRef.String)
}

func quoteEnvValue(value string) string {
	value = strings.ReplaceAll(value, "\\", "\\\\")
	value = strings.ReplaceAll(value, "\n", "\\n")
	value = strings.ReplaceAll(value, "\r", "")
	value = strings.ReplaceAll(value, "\"", "\\\"")
	value = strings.ReplaceAll(value, "$", "\\$")
	value = strings.ReplaceAll(value, "`", "\\`")
	return "\"" + value + "\""
}
