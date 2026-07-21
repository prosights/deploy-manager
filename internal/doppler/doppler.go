package doppler

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"sort"
	"strings"

	"deploy-manager/internal/connectors"
	"deploy-manager/internal/stringutil"
)

type Connector struct {
	project string
	config  string
	token   string
	command string
	run     commandRunner
}

type commandRunner func(context.Context, string, []string) ([]byte, error)

type syncConfig struct {
	Project      string   `json:"project"`
	Config       string   `json:"config"`
	Applications []string `json:"applications"`
}

func New(project string, config string, token string) Connector {
	return NewWithCommand(project, config, token, "doppler")
}

func NewWithCommand(project string, config string, token string, command string) Connector {
	return Connector{project: project, config: config, token: token, command: strings.TrimSpace(command), run: runDopplerCLI}
}

func (c Connector) Provider() string {
	return "doppler"
}

func (c Connector) SyncCredentials(_ context.Context, scope connectors.SyncScope) ([]connectors.CredentialInventory, error) {
	config, err := c.syncConfig(scope)
	if err != nil {
		return nil, err
	}

	resourceName := config.Project + "/" + config.Config
	usages := make([]connectors.CredentialUsage, 0, len(config.Applications))
	for _, application := range config.Applications {
		usages = append(usages, connectors.CredentialUsage{
			UsedByType:   "application",
			UsedByName:   application,
			UsageContext: "sync runtime variables from Doppler " + resourceName,
		})
	}
	if len(usages) == 0 {
		usages = append(usages, connectors.CredentialUsage{
			UsedByType:   "connector",
			UsedByName:   strings.TrimSpace(scope.Name),
			UsageContext: "runtime variables available from Doppler " + resourceName,
		})
	}

	return []connectors.CredentialInventory{{
		Name:        "Doppler " + resourceName + " runtime scope",
		Provider:    "doppler",
		ExternalRef: "doppler://" + resourceName,
		Type:        "runtime_scope",
		Status:      "active",
		Permissions: []connectors.CredentialPermission{{
			ResourceType: "doppler_config",
			ResourceName: resourceName,
			Permission:   "secrets:download",
			Source:       "doppler",
		}},
		Usages: usages,
	}}, nil
}

func (c Connector) RuntimeVariables(ctx context.Context, scope connectors.RuntimeVariableScope) ([]connectors.RuntimeVariable, error) {
	project := strings.TrimSpace(scope.Project)
	if project == "" {
		project = c.project
	}
	config := strings.TrimSpace(scope.Config)
	if config == "" {
		config = c.config
	}
	if project == "" && config == "" {
		return nil, nil
	}
	if project == "" || config == "" {
		return nil, fmt.Errorf("doppler project and config are required")
	}

	args := []string{c.commandPath(), "secrets", "download", "--no-file", "--format", "json", "--project", project, "--config", config}
	output, err := c.commandRunner()(ctx, c.token, args)
	if err != nil {
		return nil, fmt.Errorf("doppler secrets download failed: %w", err)
	}

	values := map[string]any{}
	if err := json.Unmarshal(output, &values); err != nil {
		return nil, err
	}

	var variables []connectors.RuntimeVariable
	for key, raw := range values {
		value, ok := scalarString(raw)
		if !ok || isMetadataKey(key) || !connectors.ValidRuntimeVariableKey(key) {
			continue
		}
		variables = append(variables, connectors.RuntimeVariable{
			Key:      key,
			Value:    value,
			IsPublic: hasPublicPrefix(key),
		})
	}
	sort.Slice(variables, func(left int, right int) bool {
		return variables[left].Key < variables[right].Key
	})
	return variables, nil
}

func (c Connector) ListProjects(ctx context.Context) ([]string, error) {
	output, err := c.commandRunner()(ctx, c.token, []string{c.commandPath(), "projects", "--json", "--no-check-version"})
	if err != nil {
		return nil, fmt.Errorf("list Doppler projects: %w", err)
	}
	var items []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(output, &items); err != nil {
		return nil, fmt.Errorf("parse Doppler projects: %w", err)
	}
	projects := make([]string, 0, len(items))
	for _, item := range items {
		projects = append(projects, item.ID)
	}
	projects = stringutil.UniqueTrimmed(projects)
	sort.Strings(projects)
	return projects, nil
}

func (c Connector) ListConfigs(ctx context.Context, project string) ([]string, error) {
	project = strings.TrimSpace(project)
	if project == "" {
		return nil, fmt.Errorf("Doppler project is required")
	}
	output, err := c.commandRunner()(ctx, c.token, []string{c.commandPath(), "configs", "--json", "--no-check-version", "--project", project})
	if err != nil {
		return nil, fmt.Errorf("list Doppler configs: %w", err)
	}
	var items []struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(output, &items); err != nil {
		return nil, fmt.Errorf("parse Doppler configs: %w", err)
	}
	configs := make([]string, 0, len(items))
	for _, item := range items {
		configs = append(configs, item.Name)
	}
	configs = stringutil.UniqueTrimmed(configs)
	sort.Strings(configs)
	return configs, nil
}

func (c Connector) commandRunner() commandRunner {
	if c.run == nil {
		return runDopplerCLI
	}
	return c.run
}

func (c Connector) Check() error {
	_, err := exec.LookPath(c.commandPath())
	if err != nil {
		return fmt.Errorf("find doppler CLI %q: %w", c.commandPath(), err)
	}
	if strings.TrimSpace(c.token) == "" {
		return fmt.Errorf("DOPPLER_TOKEN is required")
	}
	return nil
}

func (c Connector) commandPath() string {
	command := strings.TrimSpace(c.command)
	if command == "" {
		return "doppler"
	}
	return command
}

func (c Connector) syncConfig(scope connectors.SyncScope) (syncConfig, error) {
	var config syncConfig
	if len(strings.TrimSpace(string(scope.Config))) > 0 {
		if err := json.Unmarshal(scope.Config, &config); err != nil {
			return syncConfig{}, fmt.Errorf("parse doppler connector config: %w", err)
		}
	}

	config.Project = stringutil.FirstNonBlank(config.Project, c.project)
	config.Config = stringutil.FirstNonBlank(config.Config, c.config)
	if config.Project == "" || config.Config == "" {
		return syncConfig{}, fmt.Errorf("doppler connector config requires project and config")
	}
	config.Applications = stringutil.UniqueTrimmed(config.Applications)
	return config, nil
}

func runDopplerCLI(ctx context.Context, token string, args []string) ([]byte, error) {
	if len(args) == 0 {
		return nil, fmt.Errorf("doppler command is required")
	}

	cmd := exec.CommandContext(ctx, args[0], args[1:]...)
	if token != "" {
		cmd.Env = append(cmd.Environ(), "DOPPLER_TOKEN="+token)
	}
	return cmd.Output()
}

func scalarString(value any) (string, bool) {
	switch typed := value.(type) {
	case string:
		return typed, true
	case float64, bool:
		return fmt.Sprint(typed), true
	default:
		return "", false
	}
}

func hasPublicPrefix(key string) bool {
	for _, prefix := range []string{"NEXT_PUBLIC_", "PUBLIC_", "VITE_PUBLIC_"} {
		if strings.HasPrefix(key, prefix) {
			return true
		}
	}
	return false
}

func isMetadataKey(key string) bool {
	switch key {
	case "DOPPLER_PROJECT", "DOPPLER_CONFIG", "DOPPLER_ENVIRONMENT":
		return true
	default:
		return false
	}
}
