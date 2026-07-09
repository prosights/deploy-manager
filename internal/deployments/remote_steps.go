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
	label   string
	command string
	// needsDopplerToken marks steps that read a short-lived Doppler service
	// token from stdin. The token authorizes `doppler run` on the target; it
	// is never placed in the command string, the process argv, or a file.
	needsDopplerToken bool
}

type remoteStepOptions struct {
	targetColor string
	imageRef    string
	bluePort    string
	greenPort   string
	injection   connectors.RuntimeInjection
}

const (
	maxRuntimeVariableValueLength = 8192
	maxComposeProjectSlugLength   = 48
)

// readDopplerTokenCommand consumes the per-deployment service token from
// stdin so it never appears in argv (visible in `ps`), shell history, or on
// disk. `doppler run` picks it up from the exported DOPPLER_TOKEN.
const readDopplerTokenCommand = `{ IFS= read -r DOPPLER_TOKEN && [ -n "$DOPPLER_TOKEN" ]; } || { echo 'missing Doppler service token on stdin' >&2; exit 1; } && export DOPPLER_TOKEN`

// remoteSteps plans the remote deployment. Runtime environment handling is
// deliberately rigid: every docker compose command runs under
// `doppler run --no-fallback`, secrets are fetched by the target directly
// from Doppler into process memory, and no env file is ever written on the
// server. There is no alternative env path.
func remoteSteps(target db.GetDeploymentTargetRow, options ...remoteStepOptions) ([]remoteStep, error) {
	if err := validateRemoteTarget(target); err != nil {
		return nil, err
	}
	stepOptions := resolveRemoteStepOptions(target, options)
	if err := validateRuntimeInjection(stepOptions.injection); err != nil {
		return nil, err
	}
	staticEnv, err := renderEnvAssignments(artifactVariables(target, stepOptions))
	if err != nil {
		return nil, err
	}

	remoteDir := stringutil.ShellQuote(target.RemoteDirectory)
	composePath := stringutil.ShellQuote(target.ComposePath)
	steps := []remoteStep{
		{
			label:   "Preparing remote directory",
			command: fmt.Sprintf("mkdir -p %s", remoteDir),
		},
	}

	if target.RepositoryUrl.Valid && strings.TrimSpace(target.RepositoryUrl.String) != "" {
		repository := stringutil.ShellQuote(target.RepositoryUrl.String)
		branch := stringutil.ShellQuote(target.Branch)
		git := "git -c safe.directory=" + remoteDir
		commitCheckout, err := gitCommitCheckout(remoteDir, deploymentCommit(target))
		if err != nil {
			return nil, err
		}
		steps = append(steps, remoteStep{
			label: "Syncing repository",
			command: fmt.Sprintf(
				"if [ -d %[1]s/.git ]; then cd %[1]s && %[5]s fetch --prune origin %[2]s && %[5]s reset --hard && %[5]s checkout %[2]s && %[5]s reset --hard origin/%[2]s; else find %[1]s -mindepth 1 -maxdepth 1 -exec rm -rf {} + && git clone --branch %[2]s %[3]s %[1]s; fi%[4]s",
				remoteDir,
				branch,
				repository,
				commitCheckout,
				git,
			),
		})
	}

	steps = append(steps, enforceDopplerOnlyStep(target))

	dopplerRun := dopplerRunCommand(stepOptions.injection)
	if target.Strategy == "blue_green" {
		steps = append(steps, blueGreenSteps(target, stepOptions, dopplerRun, staticEnv)...)
	} else {
		project := stringutil.ShellQuote(projectSlug(target.ApplicationName))
		steps = append(steps, composeConfigStep(remoteDir, composePath, dopplerRun, staticEnv))
		if isSourceDeploy(target) {
			steps = append(steps, remoteStep{
				label:             "Building compose images",
				command:           fmt.Sprintf("cd %s && %s && %s env COMPOSE_PROJECT_NAME=%s%s docker compose -f %s build --pull", remoteDir, readDopplerTokenCommand, dopplerRun, project, staticEnv, composePath),
				needsDopplerToken: true,
			})
		} else {
			steps = append(steps, remoteStep{
				label:             "Pulling compose images",
				command:           fmt.Sprintf("cd %s && %s && %s env COMPOSE_PROJECT_NAME=%s%s docker compose -f %s pull", remoteDir, readDopplerTokenCommand, dopplerRun, project, staticEnv, composePath),
				needsDopplerToken: true,
			})
		}
		steps = append(steps, remoteStep{
			label:             "Starting compose stack",
			command:           fmt.Sprintf("cd %s && %s && %s env COMPOSE_PROJECT_NAME=%s%s docker compose -f %s up -d --remove-orphans", remoteDir, readDopplerTokenCommand, dopplerRun, project, staticEnv, composePath),
			needsDopplerToken: true,
		})
	}

	return steps, nil
}

// enforceDopplerOnlyStep is the mandate: the doppler CLI must exist on the
// target, leftover .env files from earlier deployment models are removed, and
// compose files that try to read env files are rejected outright.
func enforceDopplerOnlyStep(target db.GetDeploymentTargetRow) remoteStep {
	remoteDir := stringutil.ShellQuote(target.RemoteDirectory)
	composePath := stringutil.ShellQuote(target.ComposePath)

	removals := []string{stringutil.ShellQuote("./.env")}
	if dir := path.Dir(target.ComposePath); dir != "." {
		removals = append(removals, stringutil.ShellQuote("./"+dir+"/.env"))
	}

	command := fmt.Sprintf(
		"command -v doppler >/dev/null 2>&1 || { echo 'doppler CLI is required on the deployment target: runtime env is injected with doppler run' >&2; exit 1; }; "+
			"cd %s || exit 1; "+
			"[ -f %s ] || { echo 'compose file not found: '%s >&2; exit 1; }; "+
			"rm -f %s; "+
			"if grep -nE '^[[:space:]]*env_file[[:space:]]*:' %s; then echo 'env_file is not allowed: runtime env must be injected through Doppler, never read from files on the server' >&2; exit 1; fi",
		remoteDir,
		composePath,
		composePath,
		strings.Join(removals, " "),
		composePath,
	)
	return remoteStep{label: "Enforcing Doppler-only runtime environment", command: command}
}

func dopplerRunCommand(injection connectors.RuntimeInjection) string {
	// --no-fallback stops the doppler CLI from writing its encrypted secret
	// snapshot to disk on the target; secrets must exist in memory only.
	return fmt.Sprintf(
		"doppler run --project %s --config %s --no-fallback --",
		stringutil.ShellQuote(strings.TrimSpace(injection.Project)),
		stringutil.ShellQuote(strings.TrimSpace(injection.Config)),
	)
}

func validateRuntimeInjection(injection connectors.RuntimeInjection) error {
	project := strings.TrimSpace(injection.Project)
	config := strings.TrimSpace(injection.Config)
	if project == "" || config == "" {
		return fmt.Errorf("doppler runtime injection is required: map the application to a Doppler project/config; server-side env files are not supported")
	}
	if stringutil.HasControlCharacter(project) || stringutil.HasControlCharacter(config) {
		return fmt.Errorf("doppler project and config cannot contain control characters")
	}
	return nil
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

// artifactVariables are the non-secret, control-plane-owned variables a
// compose file may interpolate (the pinned image reference and tags). They
// are passed inline through `env` after Doppler injection so a Doppler secret
// cannot override a pinned image.
func artifactVariables(target db.GetDeploymentTargetRow, options remoteStepOptions) []connectors.RuntimeVariable {
	if options.imageRef == "" {
		return nil
	}
	variables := []connectors.RuntimeVariable{{Key: "DEPLOY_IMAGE", Value: options.imageRef}}
	if tag := imageTag(options.imageRef); tag != "" {
		variables = append(variables, connectors.RuntimeVariable{Key: "DEPLOY_IMAGE_TAG", Value: tag})
		if key := applicationImageTagKey(target.ApplicationName); key != "" {
			variables = append(variables, connectors.RuntimeVariable{Key: key, Value: tag})
		}
	}
	return variables
}

// renderEnvAssignments renders `env` assignments for non-secret variables.
// The result begins with a space when non-empty so callers can concatenate it
// directly after other assignments.
func renderEnvAssignments(variables []connectors.RuntimeVariable) (string, error) {
	var parts []string
	for _, variable := range variables {
		if !isValidRuntimeVariable(variable) {
			continue
		}
		if err := validateRuntimeVariable(variable); err != nil {
			return "", err
		}
		parts = append(parts, variable.Key+"="+stringutil.ShellQuote(variable.Value))
	}
	sort.Strings(parts)
	if len(parts) == 0 {
		return "", nil
	}
	return " " + strings.Join(parts, " "), nil
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

func blueGreenSteps(target db.GetDeploymentTargetRow, options remoteStepOptions, dopplerRun string, staticEnv string) []remoteStep {
	remoteDir := stringutil.ShellQuote(target.RemoteDirectory)
	composePath := stringutil.ShellQuote(target.ComposePath)
	project := stringutil.ShellQuote(projectSlug(target.ApplicationName))
	targetColor := stringutil.ShellQuote(defaultTargetColor(options.targetColor))

	// Dynamic assignments come after the static artifact assignments so the
	// shell-computed color and port always win for this invocation.
	colorEnv := fmt.Sprintf("env%s COMPOSE_PROJECT_NAME=%s-$color DEPLOY_COLOR=$color DEPLOY_PORT=$port", staticEnv, project)
	colorPrelude := fmt.Sprintf("color=$(cat .deploy-manager-next-color) && port=$(%s)", colorPortCommand(options))

	steps := []remoteStep{
		{
			label:   "Selecting blue-green target",
			command: fmt.Sprintf("cd %s && printf %%s %s > .deploy-manager-next-color", remoteDir, targetColor),
		},
		composeConfigStep(remoteDir, composePath, dopplerRun, staticEnv),
	}
	if isSourceDeploy(target) {
		steps = append(steps, remoteStep{
			label:             "Building next color images",
			command:           fmt.Sprintf("cd %s && %s && %s && %s %s docker compose -f %s build --pull", remoteDir, readDopplerTokenCommand, colorPrelude, dopplerRun, colorEnv, composePath),
			needsDopplerToken: true,
		})
	} else {
		steps = append(steps, remoteStep{
			label:             "Pulling next color images",
			command:           fmt.Sprintf("cd %s && %s && %s && %s %s docker compose -f %s pull", remoteDir, readDopplerTokenCommand, colorPrelude, dopplerRun, colorEnv, composePath),
			needsDopplerToken: true,
		})
	}
	steps = append(steps, remoteStep{
		label:             "Starting next color stack",
		command:           fmt.Sprintf("cd %s && %s && %s && %s %s docker compose -f %s up -d --remove-orphans", remoteDir, readDopplerTokenCommand, colorPrelude, dopplerRun, colorEnv, composePath),
		needsDopplerToken: true,
	})
	steps = append(steps, remoteStep{
		label:   "Checking next color health",
		command: fmt.Sprintf("cd %s && %s && url=$(printf %%s %s | sed \"s/{color}/$color/g\" | sed \"s/{port}/$port/g\") && curl -fsS --retry 10 --retry-delay 2 --retry-connrefused \"$url\" >/dev/null", remoteDir, colorPrelude, stringutil.ShellQuote(target.HealthCheckUrl.String)),
	})
	steps = append(steps,
		remoteStep{
			label:   "Promoting next color",
			command: fmt.Sprintf("cd %s && cat .deploy-manager-next-color > .deploy-manager-active-color", remoteDir),
		},
	)
	return steps
}

func colorPortCommand(options remoteStepOptions) string {
	bluePort := strings.TrimSpace(options.bluePort)
	if bluePort == "" {
		bluePort = "3101"
	}
	greenPort := strings.TrimSpace(options.greenPort)
	if greenPort == "" {
		greenPort = "3102"
	}
	return fmt.Sprintf("if [ \"$color\" = \"blue\" ]; then printf %%s \"${BLUE_DEPLOY_PORT:-%s}\"; else printf %%s \"${GREEN_DEPLOY_PORT:-%s}\"; fi", bluePort, greenPort)
}

func defaultTargetColor(color string) string {
	color = strings.TrimSpace(color)
	if color == "green" {
		return "green"
	}
	return "blue"
}

func composeConfigStep(remoteDir string, composePath string, dopplerRun string, staticEnv string) remoteStep {
	command := fmt.Sprintf("cd %s && %s && %s", remoteDir, readDopplerTokenCommand, dopplerRun)
	if staticEnv != "" {
		command += " env" + staticEnv
	}
	command += fmt.Sprintf(" docker compose -f %s config --quiet", composePath)
	return remoteStep{
		label:             "Validating compose config",
		command:           command,
		needsDopplerToken: true,
	}
}

var projectSlugPattern = regexp.MustCompile(`[^a-z0-9]+`)

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
