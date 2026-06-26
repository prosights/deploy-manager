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
}

const (
	maxRuntimeVariableValueLength = 8192
	maxRuntimeEnvFileLength       = 65536
	maxComposeProjectSlugLength   = 48
)

func remoteSteps(target db.GetDeploymentTargetRow, variables []connectors.RuntimeVariable) ([]remoteStep, error) {
	if err := validateRemoteTarget(target); err != nil {
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
		commitCheckout, err := gitCommitCheckout(remoteDir, deploymentCommit(target))
		if err != nil {
			return nil, err
		}
		steps = append(steps, remoteStep{
			label: "Syncing repository",
			command: fmt.Sprintf(
				"if [ -d %[1]s/.git ]; then cd %[1]s && git fetch --prune origin %[2]s && git checkout %[2]s && git pull --ff-only origin %[2]s; else rm -rf %[1]s && git clone --branch %[2]s %[3]s %[1]s; fi%[4]s",
				remoteDir,
				branch,
				repository,
				commitCheckout,
			),
		})
	}

	if len(variables) > 0 {
		envFile, err := renderRuntimeEnvFile(variables)
		if err != nil {
			return nil, err
		}
		steps = append(steps, remoteStep{
			label:   "Writing runtime environment",
			command: fmt.Sprintf("cd %s && umask 077 && printf %%s %s > .env", remoteDir, stringutil.ShellQuote(envFile)),
		})
	}

	if target.Strategy == "blue_green" {
		steps = append(steps, blueGreenSteps(target)...)
	} else {
		project := stringutil.ShellQuote(projectSlug(target.ApplicationName))
		steps = append(steps,
			composeConfigStep(remoteDir, composePath),
			remoteStep{
				label:   "Pulling compose images",
				command: fmt.Sprintf("cd %s && COMPOSE_PROJECT_NAME=%s docker compose -f %s pull", remoteDir, project, composePath),
			},
			remoteStep{
				label:   "Starting compose stack",
				command: fmt.Sprintf("cd %s && COMPOSE_PROJECT_NAME=%s docker compose -f %s up -d --remove-orphans", remoteDir, project, composePath),
			},
		)
	}

	return steps, nil
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

func blueGreenSteps(target db.GetDeploymentTargetRow) []remoteStep {
	remoteDir := stringutil.ShellQuote(target.RemoteDirectory)
	composePath := stringutil.ShellQuote(target.ComposePath)
	project := stringutil.ShellQuote(projectSlug(target.ApplicationName))

	steps := []remoteStep{
		{
			label:   "Selecting blue-green target",
			command: fmt.Sprintf("cd %s && active=$(cat .deploy-manager-active-color 2>/dev/null || echo blue) && if [ \"$active\" = \"blue\" ]; then echo green; else echo blue; fi > .deploy-manager-next-color", remoteDir),
		},
		composeConfigStep(remoteDir, composePath),
		{
			label:   "Pulling next color images",
			command: fmt.Sprintf("cd %s && color=$(cat .deploy-manager-next-color) && COMPOSE_PROJECT_NAME=%s-$color DEPLOY_COLOR=$color docker compose -f %s pull", remoteDir, project, composePath),
		},
		{
			label:   "Starting next color stack",
			command: fmt.Sprintf("cd %s && color=$(cat .deploy-manager-next-color) && COMPOSE_PROJECT_NAME=%s-$color DEPLOY_COLOR=$color docker compose -f %s up -d --remove-orphans", remoteDir, project, composePath),
		},
	}
	steps = append(steps, remoteStep{
		label:   "Checking next color health",
		command: fmt.Sprintf("cd %s && color=$(cat .deploy-manager-next-color) && url=$(printf %%s %s | sed \"s/{color}/$color/g\") && curl -fsS --retry 10 --retry-delay 2 \"$url\" >/dev/null", remoteDir, stringutil.ShellQuote(target.HealthCheckUrl.String)),
	})
	steps = append(steps,
		remoteStep{
			label:   "Promoting next color",
			command: fmt.Sprintf("cd %s && cat .deploy-manager-next-color > .deploy-manager-active-color", remoteDir),
		},
		remoteStep{
			label:   "Stopping previous color stack",
			command: fmt.Sprintf("cd %s && active=$(cat .deploy-manager-active-color) && if [ \"$active\" = \"blue\" ]; then old=green; else old=blue; fi && COMPOSE_PROJECT_NAME=%s-$old DEPLOY_COLOR=$old docker compose -f %s down --remove-orphans || true", remoteDir, project, composePath),
		},
	)
	return steps
}

func composeConfigStep(remoteDir string, composePath string) remoteStep {
	return remoteStep{
		label:   "Validating compose config",
		command: fmt.Sprintf("cd %s && docker compose -f %s config --quiet", remoteDir, composePath),
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
	return fmt.Sprintf(" && cd %s && git checkout --detach %s", remoteDir, stringutil.ShellQuote(commit)), nil
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

func quoteEnvValue(value string) string {
	value = strings.ReplaceAll(value, "\\", "\\\\")
	value = strings.ReplaceAll(value, "\n", "\\n")
	value = strings.ReplaceAll(value, "\r", "")
	value = strings.ReplaceAll(value, "\"", "\\\"")
	value = strings.ReplaceAll(value, "$", "\\$")
	value = strings.ReplaceAll(value, "`", "\\`")
	return "\"" + value + "\""
}
