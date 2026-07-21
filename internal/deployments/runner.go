package deployments

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"unicode/utf8"

	"deploy-manager/internal/auditlog"
	"deploy-manager/internal/connectors"
	"deploy-manager/internal/db"
	"deploy-manager/internal/notifications"
	proxypkg "deploy-manager/internal/proxy"
	"deploy-manager/internal/sshutil"
	"deploy-manager/internal/stringutil"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type Runner struct {
	queries runnerQueries
	logs    *LogBus
	runtime RuntimeVariableSource
	source  SourceAuthenticator
	signer  sshutil.SignerSource

	notifier notifications.Notifier
}

const (
	maxDeploymentLogMessageLength = 32768
	deploymentLogTruncatedMarker  = "\n...[truncated]"
	maxCommitMessageLength        = 500
	stackRuntimeConfigName        = "__stack__"
)

type runnerQueries interface {
	AppendAuditEvent(context.Context, db.AppendAuditEventParams) (db.AuditEvent, error)
	AppendDeploymentLog(context.Context, db.AppendDeploymentLogParams) (db.DeploymentLog, error)
	ActivateDeploymentSlot(context.Context, db.ActivateDeploymentSlotParams) ([]db.ApplicationDeploymentSlot, error)
	GetDeploymentTarget(context.Context, pgtype.UUID) (db.GetDeploymentTargetRow, error)
	GetActiveDeploymentSlot(context.Context, db.GetActiveDeploymentSlotParams) (db.ApplicationDeploymentSlot, error)
	GetStandbyDeploymentSlot(context.Context, db.GetStandbyDeploymentSlotParams) (db.ApplicationDeploymentSlot, error)
	ListApplicationServiceRuntimeConfigs(context.Context, pgtype.UUID) ([]db.ApplicationServiceRuntimeConfig, error)
	ListProjectRuntimeVariablesForApplication(context.Context, pgtype.UUID) ([]db.ProjectRuntimeVariable, error)
	ListProxyRouteTargetsForApplication(context.Context, db.ListProxyRouteTargetsForApplicationParams) ([]db.ListProxyRouteTargetsForApplicationRow, error)
	MarkApplicationConfigurationDeployed(context.Context, db.MarkApplicationConfigurationDeployedParams) (db.Application, error)
	MarkProxyRouteApplied(context.Context, pgtype.UUID) (db.ProxyRoute, error)
	MarkProxyRouteFailed(context.Context, pgtype.UUID) (db.ProxyRoute, error)
	PromoteProxyRoutes(context.Context, db.PromoteProxyRoutesParams) ([]db.ProxyRoute, error)
	SetDeploymentCommitSHA(context.Context, db.SetDeploymentCommitSHAParams) (db.Deployment, error)
	StartQueuedDeployment(context.Context, pgtype.UUID) (db.Deployment, error)
	UpdateApplicationStatus(context.Context, db.UpdateApplicationStatusParams) (db.Application, error)
	UpdateDeploymentStatus(context.Context, db.UpdateDeploymentStatusParams) (db.Deployment, error)
	UpsertDeploymentSlot(context.Context, db.UpsertDeploymentSlotParams) (db.ApplicationDeploymentSlot, error)
}

type RuntimeVariableSource interface {
	RuntimeVariables(context.Context, connectors.RuntimeVariableScope) ([]connectors.RuntimeVariable, error)
}

type SourceAuthenticator interface {
	AuthorizationHeader(context.Context, pgtype.UUID, string) (string, error)
}

func NewRunner(queries runnerQueries, logs *LogBus, notifier notifications.Notifier, runtime RuntimeVariableSource, source ...SourceAuthenticator) Runner {
	if notifier == nil {
		notifier = notifications.Noop{}
	}
	runner := Runner{queries: queries, logs: logs, notifier: notifier, runtime: runtime, signer: sshutil.FileSigner{}}
	if len(source) > 0 {
		runner.source = source[0]
	}
	return runner
}

func (r Runner) Run(ctx context.Context, deployment db.Deployment) {
	running, err := r.queries.StartQueuedDeployment(ctx, deployment.ID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			r.append(ctx, deployment, "system", "Deployment is no longer queued; skipping")
			return
		}
		r.append(ctx, deployment, "stderr", fmt.Sprintf("mark deployment running: %s", err.Error()))
		return
	}
	deployment = running
	r.append(ctx, deployment, "system", "Deployment picked up by runner")

	target, err := r.queries.GetDeploymentTarget(ctx, deployment.ID)
	if err != nil {
		r.fail(ctx, deployment, "load deployment target", err)
		return
	}
	r.audit(ctx, deployment, target, "deployment.running", map[string]any{
		"status":   "running",
		"trigger":  deployment.Trigger,
		"strategy": deployment.Strategy,
	})

	_, _ = r.queries.UpdateApplicationStatus(ctx, db.UpdateApplicationStatusParams{
		ID:      target.ApplicationID,
		Status:  "deploying",
		Version: deploymentVersion(target),
	})

	if err := r.deploy(ctx, deployment, &target); err != nil {
		failed := r.fail(ctx, deployment, "remote deployment failed", err)
		r.audit(ctx, failed, target, "deployment.failed", map[string]any{
			"status": "failed",
			"error":  err.Error(),
		})
		_, _ = r.queries.UpdateApplicationStatus(ctx, db.UpdateApplicationStatusParams{
			ID:     target.ApplicationID,
			Status: "failed",
		})
		r.notify(ctx, failed, target, err.Error())
		return
	}

	r.complete(ctx, deployment, target)
}

func (r Runner) complete(ctx context.Context, deployment db.Deployment, target db.GetDeploymentTargetRow) {
	completed, err := r.queries.UpdateDeploymentStatus(ctx, db.UpdateDeploymentStatusParams{ID: deployment.ID, Status: "succeeded"})
	if err != nil {
		r.append(ctx, deployment, "stderr", "mark deployment succeeded: "+err.Error())
		r.notify(ctx, deployment, target, "mark deployment succeeded: "+err.Error())
		return
	}
	_, _ = r.queries.UpdateApplicationStatus(ctx, db.UpdateApplicationStatusParams{
		ID:      target.ApplicationID,
		Status:  "healthy",
		Version: deploymentVersion(target),
	})
	if deployment.Trigger != "rollback" {
		if _, err := r.queries.MarkApplicationConfigurationDeployed(ctx, db.MarkApplicationConfigurationDeployedParams{
			ID:                           target.ApplicationID,
			ConfigurationRevision:        target.ConfigurationRevision,
			ProjectConfigurationRevision: target.ProjectConfigurationRevision,
		}); err != nil {
			r.append(ctx, deployment, "stderr", "mark deployed configuration: "+err.Error())
		}
	}
	r.append(ctx, deployment, "system", "Deployment completed")
	r.audit(ctx, completed, target, "deployment.succeeded", map[string]any{"status": "succeeded"})
	r.notify(ctx, completed, target, "")
}

func (r Runner) append(ctx context.Context, deployment db.Deployment, stream string, message string) {
	message, ok := normalizeDeploymentLogMessage(message)
	if !ok {
		return
	}
	entry, err := r.queries.AppendDeploymentLog(ctx, db.AppendDeploymentLogParams{
		DeploymentID: deployment.ID,
		Stream:       stream,
		Message:      message,
	})
	if err == nil {
		r.logs.Publish(ctx, deploymentLogEvent(entry))
		return
	}
	r.logs.Publish(ctx, LogEvent{DeploymentID: uuidString(deployment.ID), Stream: stream, Message: message})
}

func normalizeDeploymentLogMessage(message string) (string, bool) {
	message = stringutil.RedactSensitiveText(message)
	if strings.TrimSpace(message) == "" {
		return "", false
	}
	if utf8.RuneCountInString(message) <= maxDeploymentLogMessageLength {
		return message, true
	}

	maxBodyLength := maxDeploymentLogMessageLength - utf8.RuneCountInString(deploymentLogTruncatedMarker)
	runes := []rune(message)
	return string(runes[:maxBodyLength]) + deploymentLogTruncatedMarker, true
}

func deploymentLogEvent(entry db.DeploymentLog) LogEvent {
	return LogEvent{
		ID:           entry.ID,
		DeploymentID: uuidString(entry.DeploymentID),
		Stream:       entry.Stream,
		Message:      entry.Message,
		CreatedAt:    entry.CreatedAt,
	}
}

func (r Runner) deploy(ctx context.Context, deployment db.Deployment, target *db.GetDeploymentTargetRow) error {
	if target.ConnectionMode != sshutil.ConnectionModeTailscaleSSH && (!target.SshKeyPath.Valid || strings.TrimSpace(target.SshKeyPath.String) == "") {
		return fmt.Errorf("server %s has no ssh key path configured", target.ServerName)
	}

	client, err := deploymentSSHClient(ctx, *target, r.signer)
	if err != nil {
		return fmt.Errorf("prepare ssh client: %w", err)
	}

	r.append(ctx, deployment, "system", fmt.Sprintf("Connecting to %s@%s", target.SshUser, target.Hostname))
	r.append(ctx, deployment, "system", fmt.Sprintf("Strategy: %s", target.Strategy))
	if deployment.Trigger == "rollback" {
		return r.rollback(ctx, deployment, *target, client)
	}

	variables, err := r.deploymentRuntimeVariables(ctx, *target)
	if err != nil {
		return err
	}
	serviceVariables, err := r.deploymentServiceRuntimeVariables(ctx, *target, variables)
	if err != nil {
		return err
	}
	if len(variables) > 0 || len(serviceVariables) > 0 {
		r.append(ctx, deployment, "system", fmt.Sprintf("Runtime variables synced: %d shared, %d service environments", validRuntimeVariableCount(variables), len(serviceVariables)))
	}

	targetColor, err := r.nextDeploymentColor(ctx, *target)
	if err != nil {
		return err
	}
	ports, err := r.blueGreenPorts(ctx, *target)
	if err != nil {
		return err
	}
	sourceAuthorizationHeader, err := r.sourceAuthorizationHeader(ctx, *target, deployment.ImageRef.String)
	if err != nil {
		return err
	}
	steps, err := remoteSteps(*target, variables, remoteStepOptions{
		targetColor:               targetColor,
		imageRef:                  deployment.ImageRef.String,
		bluePort:                  ports.blue,
		greenPort:                 ports.green,
		portVariables:             ports.variables,
		serviceVariables:          serviceVariables,
		sourceAuthorizationHeader: sourceAuthorizationHeader,
	})
	if err != nil {
		return err
	}
	for _, step := range steps {
		r.append(ctx, deployment, "system", step.label)
		var output string
		if step.input == "" {
			output, err = client.Run(ctx, step.command)
		} else {
			output, err = client.RunWithInput(ctx, step.command, step.input)
		}
		if strings.TrimSpace(output) != "" {
			r.append(ctx, deployment, "stdout", output)
		}
		if err != nil {
			return fmt.Errorf("%s: %w", step.label, err)
		}
		if step.resolvesCommit {
			if err := r.resolveSourceCommit(ctx, deployment, target, client); err != nil {
				return err
			}
		}
	}
	if target.Strategy == "blue_green" && blueGreenSlotTracked(*target) {
		if err := r.upsertSlot(ctx, deployment, *target, targetColor, "standby"); err != nil {
			return err
		}
	}
	if err := r.applyProxyRoutes(ctx, deployment, *target, client, targetColor); err != nil {
		return err
	}
	if target.Strategy == "blue_green" && blueGreenSlotTracked(*target) {
		if _, err := r.queries.ActivateDeploymentSlot(ctx, db.ActivateDeploymentSlotParams{
			ApplicationID: target.ApplicationID,
			ServerID:      target.ServerID,
			Color:         targetColor,
		}); err != nil {
			return fmt.Errorf("mark active deployment slot: %w", err)
		}
	}

	return nil
}

func (r Runner) sourceAuthorizationHeader(ctx context.Context, target db.GetDeploymentTargetRow, imageRef string) (string, error) {
	if r.source == nil || strings.TrimSpace(imageRef) != "" || !isSourceDeploy(target) {
		return "", nil
	}
	header, err := r.source.AuthorizationHeader(ctx, target.RepositoryConnectorID, target.RepositoryUrl.String)
	if err != nil {
		return "", fmt.Errorf("authenticate source repository: %w", err)
	}
	return header, nil
}

func (r Runner) deploymentRuntimeVariables(ctx context.Context, target db.GetDeploymentTargetRow) ([]connectors.RuntimeVariable, error) {
	projectVariables, err := r.queries.ListProjectRuntimeVariablesForApplication(ctx, target.ApplicationID)
	if err != nil {
		return nil, fmt.Errorf("load project runtime variables: %w", err)
	}

	variables := make([]connectors.RuntimeVariable, 0, len(projectVariables))
	for _, variable := range projectVariables {
		variables = append(variables, connectors.RuntimeVariable{Key: variable.Key, Value: variable.Value})
	}
	if r.runtime == nil {
		return variables, nil
	}

	dopplerVariables, err := r.runtime.RuntimeVariables(ctx, runtimeScope(target))
	if err != nil {
		return nil, fmt.Errorf("sync runtime variables: %w", err)
	}
	return mergeRuntimeVariables(variables, dopplerVariables), nil
}

func (r Runner) deploymentServiceRuntimeVariables(ctx context.Context, target db.GetDeploymentTargetRow, shared []connectors.RuntimeVariable) (map[string][]connectors.RuntimeVariable, error) {
	configs, err := r.queries.ListApplicationServiceRuntimeConfigs(ctx, target.ApplicationID)
	if err != nil {
		return nil, fmt.Errorf("load compose service runtime configuration: %w", err)
	}
	stackVariables := shared
	for _, config := range configs {
		if config.ComposeService != stackRuntimeConfigName {
			continue
		}
		variables, err := runtimeConfigVariables(config)
		if err != nil {
			return nil, fmt.Errorf("decode stack runtime variables: %w", err)
		}
		stackVariables = mergeRuntimeVariables(shared, variables)
		if r.runtime != nil && config.DopplerProject.Valid && config.DopplerConfig.Valid {
			dopplerVariables, err := r.runtime.RuntimeVariables(ctx, connectors.RuntimeVariableScope{
				ApplicationName: target.ApplicationName + "/stack",
				Project:         strings.TrimSpace(config.DopplerProject.String),
				Config:          strings.TrimSpace(config.DopplerConfig.String),
			})
			if err != nil {
				return nil, fmt.Errorf("sync runtime variables for stack: %w", err)
			}
			stackVariables = mergeRuntimeVariables(stackVariables, dopplerVariables)
		}
	}

	services := make(map[string][]connectors.RuntimeVariable, len(configs))
	for _, name := range deploymentComposeServiceNames(target.ComposeServices) {
		services[name] = stackVariables
	}
	for _, config := range configs {
		if config.ComposeService == stackRuntimeConfigName {
			continue
		}
		direct, err := runtimeConfigVariables(config)
		if err != nil {
			return nil, fmt.Errorf("decode runtime variables for compose service %s: %w", config.ComposeService, err)
		}
		variables := mergeRuntimeVariables(stackVariables, direct)
		if r.runtime != nil && config.DopplerProject.Valid && config.DopplerConfig.Valid {
			dopplerVariables, err := r.runtime.RuntimeVariables(ctx, connectors.RuntimeVariableScope{
				ApplicationName: target.ApplicationName + "/" + config.ComposeService,
				Project:         strings.TrimSpace(config.DopplerProject.String),
				Config:          strings.TrimSpace(config.DopplerConfig.String),
			})
			if err != nil {
				return nil, fmt.Errorf("sync runtime variables for compose service %s: %w", config.ComposeService, err)
			}
			variables = mergeRuntimeVariables(variables, dopplerVariables)
		}
		services[config.ComposeService] = variables
	}
	return services, nil
}

func runtimeConfigVariables(config db.ApplicationServiceRuntimeConfig) ([]connectors.RuntimeVariable, error) {
	var inputs []struct {
		Key   string `json:"key"`
		Value string `json:"value"`
	}
	if err := json.Unmarshal(config.Variables, &inputs); err != nil {
		return nil, err
	}
	variables := make([]connectors.RuntimeVariable, 0, len(inputs))
	for _, input := range inputs {
		variables = append(variables, connectors.RuntimeVariable{Key: input.Key, Value: input.Value})
	}
	return variables, nil
}

func deploymentComposeServiceNames(raw []byte) []string {
	var services []struct {
		Name string `json:"name"`
	}
	if json.Unmarshal(raw, &services) != nil {
		return nil
	}
	names := make([]string, 0, len(services))
	for _, service := range services {
		if service.Name != "" {
			names = append(names, service.Name)
		}
	}
	return names
}

func mergeRuntimeVariables(projectVariables []connectors.RuntimeVariable, dopplerVariables []connectors.RuntimeVariable) []connectors.RuntimeVariable {
	byKey := make(map[string]connectors.RuntimeVariable, len(projectVariables)+len(dopplerVariables))
	for _, variable := range projectVariables {
		byKey[variable.Key] = variable
	}
	for _, variable := range dopplerVariables {
		byKey[variable.Key] = variable
	}

	keys := make([]string, 0, len(byKey))
	for key := range byKey {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	variables := make([]connectors.RuntimeVariable, 0, len(keys))
	for _, key := range keys {
		variables = append(variables, byKey[key])
	}
	return variables
}

func (r Runner) resolveSourceCommit(ctx context.Context, deployment db.Deployment, target *db.GetDeploymentTargetRow, client remoteRunner) error {
	output, err := client.Run(ctx, "cd "+stringutil.ShellQuote(target.RemoteDirectory)+" && git log -1 --format='%H%n%s'")
	if err != nil {
		return fmt.Errorf("resolve source commit: %w", err)
	}
	parts := strings.SplitN(strings.TrimRight(output, "\r\n"), "\n", 2)
	commit := strings.TrimSpace(parts[0])
	decoded, decodeErr := hex.DecodeString(commit)
	if decodeErr != nil || len(decoded) != 20 {
		return fmt.Errorf("resolve source commit: git returned an invalid SHA")
	}
	message := ""
	if len(parts) == 2 {
		message = strings.TrimSpace(parts[1])
		if !utf8.ValidString(message) || stringutil.HasControlCharacter(message) {
			message = ""
		} else if runes := []rune(message); len(runes) > maxCommitMessageLength {
			message = string(runes[:maxCommitMessageLength])
		}
	}
	pinned, err := r.queries.SetDeploymentCommitSHA(ctx, db.SetDeploymentCommitSHAParams{
		DeploymentID:  deployment.ID,
		CommitSha:     commit,
		CommitMessage: message,
	})
	if err != nil {
		return fmt.Errorf("record source commit: %w", err)
	}
	target.CommitSha = pinned.CommitSha
	r.append(ctx, deployment, "system", "Source commit: "+commit[:12])
	return nil
}

func deploymentSSHClient(ctx context.Context, target db.GetDeploymentTargetRow, signerSource sshutil.SignerSource) (sshutil.Client, error) {
	if target.ConnectionMode == sshutil.ConnectionModeTailscaleSSH {
		if sshutil.IsLocalTailscaleHost(ctx, target.Hostname) {
			return sshutil.NewLocalDockerHostClient(target.SshUser), nil
		}
		return sshutil.NewTailscaleSSHClient(target.Hostname, target.SshPort, target.SshUser), nil
	}
	if signerSource == nil {
		signerSource = sshutil.FileSigner{}
	}
	signer, err := signerSource.Signer(ctx, sshutil.ServerRef{
		Host:    target.Hostname,
		Port:    target.SshPort,
		User:    target.SshUser,
		KeyPath: target.SshKeyPath.String,
	})
	if err != nil {
		return sshutil.Client{}, err
	}
	return sshutil.NewClient(target.Hostname, target.SshPort, target.SshUser, signer), nil
}

type remoteRunner interface {
	Run(context.Context, string) (string, error)
}

func (r Runner) rollback(ctx context.Context, deployment db.Deployment, target db.GetDeploymentTargetRow, client remoteRunner) error {
	slot, err := r.queries.GetStandbyDeploymentSlot(ctx, db.GetStandbyDeploymentSlotParams{
		ApplicationID: target.ApplicationID,
		ServerID:      target.ServerID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("no standby blue-green slot is available for rollback")
		}
		return fmt.Errorf("load rollback slot: %w", err)
	}
	r.append(ctx, deployment, "system", "Rolling back traffic to "+slot.Color)
	if err := r.checkColorHealth(ctx, target, client, slot.Color); err != nil {
		return err
	}
	if err := r.applyProxyRoutes(ctx, deployment, target, client, slot.Color); err != nil {
		return err
	}
	if _, err := r.queries.ActivateDeploymentSlot(ctx, db.ActivateDeploymentSlotParams{
		ApplicationID: target.ApplicationID,
		ServerID:      target.ServerID,
		Color:         slot.Color,
	}); err != nil {
		return fmt.Errorf("mark rollback slot active: %w", err)
	}
	return nil
}

func (r Runner) nextDeploymentColor(ctx context.Context, target db.GetDeploymentTargetRow) (string, error) {
	if target.Strategy != "blue_green" {
		return "", nil
	}
	slot, err := r.queries.GetActiveDeploymentSlot(ctx, db.GetActiveDeploymentSlotParams{
		ApplicationID: target.ApplicationID,
		ServerID:      target.ServerID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "blue", nil
		}
		return "", fmt.Errorf("load active deployment slot: %w", err)
	}
	if slot.Color == "blue" {
		return "green", nil
	}
	return "blue", nil
}

func (r Runner) upsertSlot(ctx context.Context, deployment db.Deployment, target db.GetDeploymentTargetRow, color string, status string) error {
	_, err := r.queries.UpsertDeploymentSlot(ctx, db.UpsertDeploymentSlotParams{
		ApplicationID: target.ApplicationID,
		ServerID:      target.ServerID,
		Color:         color,
		DeploymentID:  deployment.ID,
		ImageRef:      slotRollbackRef(target),
		ImageDigest:   target.ImageDigest,
		Status:        status,
	})
	if err != nil {
		return fmt.Errorf("record deployment slot: %w", err)
	}
	return nil
}

// blueGreenSlotTracked reports whether a blue/green deployment records a
// rollback slot. Artifact deploys track by image_ref; source deploys (built on
// the target from a repo) track by commit_sha instead, so both always leave a
// standby slot to roll back to.
func blueGreenSlotTracked(target db.GetDeploymentTargetRow) bool {
	return slotRollbackRef(target) != ""
}

// slotRollbackRef is the identity stored in a deployment slot so a later
// rollback knows what to restore: the pinned image_ref when present, otherwise
// the commit_sha the target was built from.
func slotRollbackRef(target db.GetDeploymentTargetRow) string {
	if ref := deploymentImageRef(target); ref != "" {
		return ref
	}
	return strings.TrimSpace(target.CommitSha.String)
}

func (r Runner) checkColorHealth(ctx context.Context, target db.GetDeploymentTargetRow, client remoteRunner, color string) error {
	if target.Strategy != "blue_green" {
		return nil
	}
	healthCheckURL := strings.TrimSpace(target.HealthCheckUrl.String)
	if !target.HealthCheckUrl.Valid || healthCheckURL == "" {
		return fmt.Errorf("blue_green deployments require a health_check_url")
	}
	ports, err := r.blueGreenPorts(ctx, target)
	if err != nil {
		return err
	}
	command := fmt.Sprintf("curl -fsS --retry 3 --retry-delay 1 %s >/dev/null", shellQuoteColorURL(deploymentHealthCheckURL(target, healthCheckURL), color, ports))
	if output, err := client.Run(ctx, command); err != nil {
		if strings.TrimSpace(output) != "" {
			return fmt.Errorf("rollback health check failed: %w: %s", err, strings.TrimSpace(output))
		}
		return fmt.Errorf("rollback health check failed: %w", err)
	}
	return nil
}

func shellQuoteColorURL(healthCheckURL string, color string, ports blueGreenPorts) string {
	healthCheckURL = strings.ReplaceAll(healthCheckURL, "{color}", color)
	healthCheckURL = strings.ReplaceAll(healthCheckURL, "{port}", colorPort(color, ports))
	return stringutil.ShellQuote(healthCheckURL)
}

func colorPort(color string, ports blueGreenPorts) string {
	if color == "green" {
		if ports.green != "" {
			return ports.green
		}
		return "3102"
	}
	if ports.blue != "" {
		return ports.blue
	}
	return "3101"
}

type blueGreenPorts struct {
	blue      string
	green     string
	variables []composePortVariable
}

func (r Runner) blueGreenPorts(ctx context.Context, target db.GetDeploymentTargetRow) (blueGreenPorts, error) {
	if target.Strategy != "blue_green" {
		return blueGreenPorts{}, nil
	}
	routes, err := r.queries.ListProxyRouteTargetsForApplication(ctx, db.ListProxyRouteTargetsForApplicationParams{
		ApplicationID: target.ApplicationID,
		ServerID:      target.ServerID,
	})
	if err != nil {
		return blueGreenPorts{}, fmt.Errorf("load proxy route ports: %w", err)
	}
	ports, err := routePorts(routes)
	if err != nil || len(routes) > 0 {
		return ports, err
	}
	return composeMetadataPorts(target.ComposeServices), nil
}

func composeMetadataPorts(raw []byte) blueGreenPorts {
	var services []struct {
		Name  string `json:"name"`
		Ports []struct {
			ContainerPort int `json:"container_port"`
			PublishedPort int `json:"published_port"`
		} `json:"ports"`
	}
	if json.Unmarshal(raw, &services) != nil {
		return blueGreenPorts{}
	}
	result := blueGreenPorts{}
	for _, service := range services {
		for _, port := range service.Ports {
			if port.ContainerPort < 1 || port.PublishedPort < 1 {
				continue
			}
			name := fmt.Sprintf("DEPLOY_PORT_%s_%d", strings.ToUpper(strings.NewReplacer("-", "_", ".", "_").Replace(service.Name)), port.ContainerPort)
			if result.blue == "" {
				result.blue = fmt.Sprint(port.PublishedPort)
				result.green = fmt.Sprint(port.PublishedPort + 1)
				name = "DEPLOY_PORT"
			}
			result.variables = append(result.variables, composePortVariable{name: name, serviceName: service.Name, containerPort: int32(port.ContainerPort), bluePort: fmt.Sprint(port.PublishedPort), greenPort: fmt.Sprint(port.PublishedPort + 1)})
		}
	}
	return result
}

func deploymentHealthCheckURL(target db.GetDeploymentTargetRow, healthCheckURL string) string {
	if strings.TrimSpace(target.Hostname) == "playground" {
		return strings.Replace(healthCheckURL, "://127.0.0.1", "://host.docker.internal", 1)
	}
	return healthCheckURL
}

func upstreamPort(value pgtype.Text) string {
	if !value.Valid {
		return ""
	}
	parsed, err := url.Parse(strings.TrimSpace(value.String))
	if err != nil {
		return ""
	}
	return parsed.Port()
}

func (r Runner) applyProxyRoutes(ctx context.Context, deployment db.Deployment, target db.GetDeploymentTargetRow, client remoteRunner, color string) error {
	if target.ProxyType == "none" {
		return nil
	}
	routes, err := r.queries.ListProxyRouteTargetsForApplication(ctx, db.ListProxyRouteTargetsForApplicationParams{
		ApplicationID: target.ApplicationID,
		ServerID:      target.ServerID,
	})
	if err != nil {
		return fmt.Errorf("load proxy routes: %w", err)
	}
	prepared := make([]preparedProxyRoute, 0, len(routes))
	for _, route := range routes {
		item, err := prepareProxyRoute(route, color)
		if err != nil {
			_, _ = r.queries.MarkProxyRouteFailed(ctx, route.ID)
			return fmt.Errorf("prepare proxy route %s: %w", route.Domain, err)
		}
		prepared = append(prepared, item)
	}

	applied := make([]preparedProxyRoute, 0, len(prepared))
	for _, item := range prepared {
		r.append(ctx, deployment, "system", "Applying proxy route "+item.route.Domain)
		output, err := client.Run(ctx, item.command)
		if strings.TrimSpace(output) != "" {
			r.append(ctx, deployment, "stdout", output)
		}
		if err != nil {
			_, _ = r.queries.MarkProxyRouteFailed(ctx, item.route.ID)
			rollbackProxyRoutes(ctx, client, applied)
			return fmt.Errorf("apply proxy route %s: %w", item.route.Domain, err)
		}
		applied = append(applied, item)
	}

	ids := make([]pgtype.UUID, 0, len(prepared))
	upstreams := make([]string, 0, len(prepared))
	for _, item := range prepared {
		ids = append(ids, item.route.ID)
		upstreams = append(upstreams, item.upstream)
	}
	if len(ids) > 0 {
		promoted, err := r.queries.PromoteProxyRoutes(ctx, db.PromoteProxyRoutesParams{RouteIds: ids, UpstreamUrls: upstreams})
		if err != nil || len(promoted) != len(prepared) {
			rollbackProxyRoutes(ctx, client, applied)
			if err != nil {
				return fmt.Errorf("record promoted proxy routes: %w", err)
			}
			return fmt.Errorf("record promoted proxy routes: updated %d of %d routes", len(promoted), len(prepared))
		}
	}
	return nil
}

type preparedProxyRoute struct {
	route           db.ListProxyRouteTargetsForApplicationRow
	upstream        string
	command         string
	rollbackCommand string
}

func prepareProxyRoute(route db.ListProxyRouteTargetsForApplicationRow, color string) (preparedProxyRoute, error) {
	upstream, err := proxyRouteUpstream(route, color)
	if err != nil {
		return preparedProxyRoute{}, err
	}
	command, err := proxypkg.BuildCommand(proxypkg.Target{
		Domain: route.Domain, Upstream: upstream, TLSEnabled: route.TlsEnabled, ProxyType: route.ProxyType,
	})
	if err != nil {
		return preparedProxyRoute{}, err
	}
	rollbackCommand, err := proxypkg.BuildCommand(proxypkg.Target{
		Domain: route.Domain, Upstream: route.UpstreamUrl, TLSEnabled: route.TlsEnabled, ProxyType: route.ProxyType,
	})
	if err != nil {
		return preparedProxyRoute{}, err
	}
	return preparedProxyRoute{route: route, upstream: upstream, command: command, rollbackCommand: rollbackCommand}, nil
}

func rollbackProxyRoutes(ctx context.Context, client remoteRunner, applied []preparedProxyRoute) {
	for index := len(applied) - 1; index >= 0; index-- {
		_, _ = client.Run(ctx, applied[index].rollbackCommand)
	}
}

func proxyRouteUpstream(route db.ListProxyRouteTargetsForApplicationRow, color string) (string, error) {
	switch color {
	case "blue":
		if route.BlueUpstreamUrl.Valid && strings.TrimSpace(route.BlueUpstreamUrl.String) != "" {
			return strings.TrimSpace(route.BlueUpstreamUrl.String), nil
		}
	case "green":
		if route.GreenUpstreamUrl.Valid && strings.TrimSpace(route.GreenUpstreamUrl.String) != "" {
			return strings.TrimSpace(route.GreenUpstreamUrl.String), nil
		}
	case "":
		return route.UpstreamUrl, nil
	}
	return "", fmt.Errorf("%s_upstream_url is required", color)
}

func runtimeScope(target db.GetDeploymentTargetRow) connectors.RuntimeVariableScope {
	return connectors.RuntimeVariableScope{
		ApplicationName: target.ApplicationName,
		Project:         strings.TrimSpace(target.DopplerProject.String),
		Config:          strings.TrimSpace(target.DopplerConfig.String),
	}
}

func deploymentVersion(target db.GetDeploymentTargetRow) pgtype.Text {
	if target.ImageDigest.Valid && strings.TrimSpace(target.ImageDigest.String) != "" {
		return pgtype.Text{String: strings.TrimSpace(target.ImageDigest.String), Valid: true}
	}
	if target.ImageRef.Valid && strings.TrimSpace(target.ImageRef.String) != "" {
		return pgtype.Text{String: strings.TrimSpace(target.ImageRef.String), Valid: true}
	}
	return target.CommitSha
}

func (r Runner) fail(ctx context.Context, deployment db.Deployment, label string, err error) db.Deployment {
	r.append(ctx, deployment, "stderr", fmt.Sprintf("%s: %s", label, err.Error()))
	failed, updateErr := r.queries.UpdateDeploymentStatus(ctx, db.UpdateDeploymentStatusParams{ID: deployment.ID, Status: "failed"})
	if updateErr != nil {
		deployment.Status = "failed"
		return deployment
	}
	return failed
}

func (r Runner) notify(ctx context.Context, deployment db.Deployment, target db.GetDeploymentTargetRow, failure string) {
	if err := r.notifier.NotifyDeployment(ctx, notifications.DeploymentEvent{
		DeploymentID:    uuidString(deployment.ID),
		ApplicationName: target.ApplicationName,
		ServerName:      target.ServerName,
		Status:          deployment.Status,
		Trigger:         deployment.Trigger,
		CommitSHA:       target.CommitSha.String,
		Error:           failure,
	}); err != nil {
		r.append(ctx, deployment, "system", "Deployment notification failed: "+err.Error())
	}
}

func (r Runner) audit(ctx context.Context, deployment db.Deployment, target db.GetDeploymentTargetRow, action string, metadata map[string]any) {
	_, _ = r.queries.AppendAuditEvent(ctx, db.AppendAuditEventParams{
		Actor:      deploymentActor(deployment),
		Action:     action,
		TargetType: "deployment",
		TargetID:   uuidString(deployment.ID),
		TargetName: target.ApplicationName,
		Metadata:   auditlog.Metadata(metadata),
	})
}

func deploymentActor(deployment db.Deployment) string {
	actor := strings.TrimSpace(deployment.Actor.String)
	if deployment.Actor.Valid && actor != "" {
		return actor
	}
	return "system"
}
