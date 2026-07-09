package doppler

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"regexp"
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

// deploymentTokenMaxAge bounds how long a per-deployment service token stays
// valid. It only needs to outlive the deployment's compose steps (including a
// source build on the target); Doppler revokes it automatically afterwards.
const deploymentTokenMaxAge = "30m"

var serviceTokenNamePattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)

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
			UsageContext: "inject runtime variables at deploy time from Doppler " + resourceName,
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
			Permission:   "service_tokens:create",
			Source:       "doppler",
		}},
		Usages: usages,
	}}, nil
}

// IssueRuntimeInjection mints a short-lived, read-only Doppler service token
// scoped to the application's project/config so the deployment target can run
// `doppler run -- docker compose ...`. Secret values are never downloaded by
// Deploy Manager; the target fetches them directly from Doppler in memory.
func (c Connector) IssueRuntimeInjection(ctx context.Context, scope connectors.RuntimeVariableScope, name string) (connectors.RuntimeInjection, error) {
	project := stringutil.FirstNonBlank(scope.Project, c.project)
	config := stringutil.FirstNonBlank(scope.Config, c.config)
	if project == "" || config == "" {
		return connectors.RuntimeInjection{}, fmt.Errorf("doppler project and config are required: runtime env is injected exclusively through Doppler")
	}
	name = strings.TrimSpace(name)
	if !serviceTokenNamePattern.MatchString(name) {
		return connectors.RuntimeInjection{}, fmt.Errorf("doppler service token name is invalid")
	}

	args := []string{
		c.commandPath(), "configs", "tokens", "create", name,
		"--project", project,
		"--config", config,
		"--max-age", deploymentTokenMaxAge,
		"--plain",
	}
	output, err := c.commandRunner()(ctx, c.token, args)
	if err != nil {
		return connectors.RuntimeInjection{}, fmt.Errorf("doppler service token create failed for %s/%s: %w", project, config, err)
	}
	token := strings.TrimSpace(string(output))
	if token == "" || strings.ContainsAny(token, " \t\r\n") {
		return connectors.RuntimeInjection{}, fmt.Errorf("doppler returned an invalid service token for %s/%s", project, config)
	}
	return connectors.RuntimeInjection{Project: project, Config: config, Token: token}, nil
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
