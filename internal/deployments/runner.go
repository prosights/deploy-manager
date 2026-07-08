package deployments

import (
	"context"
	"errors"
	"fmt"
	"net/url"
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
	signer  sshutil.SignerSource

	notifier notifications.Notifier
}

const (
	maxDeploymentLogMessageLength = 32768
	deploymentLogTruncatedMarker  = "\n...[truncated]"
)

type runnerQueries interface {
	AppendAuditEvent(context.Context, db.AppendAuditEventParams) (db.AuditEvent, error)
	AppendDeploymentLog(context.Context, db.AppendDeploymentLogParams) (db.DeploymentLog, error)
	ActivateDeploymentSlot(context.Context, db.ActivateDeploymentSlotParams) ([]db.ApplicationDeploymentSlot, error)
	GetDeploymentTarget(context.Context, pgtype.UUID) (db.GetDeploymentTargetRow, error)
	GetActiveDeploymentSlot(context.Context, db.GetActiveDeploymentSlotParams) (db.ApplicationDeploymentSlot, error)
	GetStandbyDeploymentSlot(context.Context, db.GetStandbyDeploymentSlotParams) (db.ApplicationDeploymentSlot, error)
	ListProxyRouteTargetsForApplication(context.Context, db.ListProxyRouteTargetsForApplicationParams) ([]db.ListProxyRouteTargetsForApplicationRow, error)
	MarkProxyRouteApplied(context.Context, pgtype.UUID) (db.ProxyRoute, error)
	MarkProxyRouteFailed(context.Context, pgtype.UUID) (db.ProxyRoute, error)
	StartQueuedDeployment(context.Context, pgtype.UUID) (db.Deployment, error)
	UpdateApplicationStatus(context.Context, db.UpdateApplicationStatusParams) (db.Application, error)
	UpdateDeploymentStatus(context.Context, db.UpdateDeploymentStatusParams) (db.Deployment, error)
	UpdateProxyRouteUpstream(context.Context, db.UpdateProxyRouteUpstreamParams) (db.ProxyRoute, error)
	UpsertDeploymentSlot(context.Context, db.UpsertDeploymentSlotParams) (db.ApplicationDeploymentSlot, error)
}

type RuntimeVariableSource interface {
	RuntimeVariables(context.Context, connectors.RuntimeVariableScope) ([]connectors.RuntimeVariable, error)
}

func NewRunner(queries runnerQueries, logs *LogBus, notifier notifications.Notifier, runtime RuntimeVariableSource) Runner {
	if notifier == nil {
		notifier = notifications.Noop{}
	}
	return Runner{queries: queries, logs: logs, notifier: notifier, runtime: runtime, signer: sshutil.FileSigner{}}
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

	if err := r.deploy(ctx, deployment, target); err != nil {
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

func (r Runner) deploy(ctx context.Context, deployment db.Deployment, target db.GetDeploymentTargetRow) error {
	if target.ConnectionMode != sshutil.ConnectionModeTailscaleSSH && (!target.SshKeyPath.Valid || strings.TrimSpace(target.SshKeyPath.String) == "") {
		return fmt.Errorf("server %s has no ssh key path configured", target.ServerName)
	}

	client, err := deploymentSSHClient(ctx, target, r.signer)
	if err != nil {
		return fmt.Errorf("prepare ssh client: %w", err)
	}

	r.append(ctx, deployment, "system", fmt.Sprintf("Connecting to %s@%s", target.SshUser, target.Hostname))
	r.append(ctx, deployment, "system", fmt.Sprintf("Strategy: %s", target.Strategy))
	if deployment.Trigger == "rollback" {
		return r.rollback(ctx, deployment, target, client)
	}

	var variables []connectors.RuntimeVariable
	if r.runtime != nil {
		var runtimeErr error
		variables, runtimeErr = r.runtime.RuntimeVariables(ctx, runtimeScope(target))
		if runtimeErr != nil {
			return fmt.Errorf("sync runtime variables: %w", runtimeErr)
		}
		r.append(ctx, deployment, "system", fmt.Sprintf("Runtime variables synced: %d", validRuntimeVariableCount(variables)))
	}

	targetColor, err := r.nextDeploymentColor(ctx, target)
	if err != nil {
		return err
	}
	ports, err := r.blueGreenPorts(ctx, target)
	if err != nil {
		return err
	}
	steps, err := remoteSteps(target, variables, remoteStepOptions{targetColor: targetColor, bluePort: ports.blue, greenPort: ports.green})
	if err != nil {
		return err
	}
	for _, step := range steps {
		r.append(ctx, deployment, "system", step.label)
		output, err := client.Run(ctx, step.command)
		if strings.TrimSpace(output) != "" {
			r.append(ctx, deployment, "stdout", output)
		}
		if err != nil {
			return fmt.Errorf("%s: %w", step.label, err)
		}
	}
	if target.Strategy == "blue_green" && blueGreenSlotTracked(target) {
		if err := r.upsertSlot(ctx, deployment, target, targetColor, "standby"); err != nil {
			return err
		}
	}
	if err := r.applyProxyRoutes(ctx, deployment, target, client, targetColor); err != nil {
		return err
	}
	if target.Strategy == "blue_green" && blueGreenSlotTracked(target) {
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
	command := fmt.Sprintf("curl -fsS --retry 3 --retry-delay 1 %s >/dev/null", shellQuoteColorURL(healthCheckURL, color, ports))
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
	blue  string
	green string
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
	for _, route := range routes {
		ports := blueGreenPorts{
			blue:  upstreamPort(route.BlueUpstreamUrl),
			green: upstreamPort(route.GreenUpstreamUrl),
		}
		if ports.blue != "" || ports.green != "" {
			return ports, nil
		}
	}
	return blueGreenPorts{}, nil
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
	for _, route := range routes {
		if err := r.applyProxyRoute(ctx, deployment, route, client, color); err != nil {
			return err
		}
	}
	return nil
}

func (r Runner) applyProxyRoute(ctx context.Context, deployment db.Deployment, route db.ListProxyRouteTargetsForApplicationRow, client remoteRunner, color string) error {
	upstream, err := proxyRouteUpstream(route, color)
	if err != nil {
		_, _ = r.queries.MarkProxyRouteFailed(ctx, route.ID)
		return fmt.Errorf("select proxy upstream %s: %w", route.Domain, err)
	}
	if upstream != route.UpstreamUrl {
		updated, err := r.queries.UpdateProxyRouteUpstream(ctx, db.UpdateProxyRouteUpstreamParams{ID: route.ID, UpstreamUrl: upstream})
		if err != nil {
			_, _ = r.queries.MarkProxyRouteFailed(ctx, route.ID)
			return fmt.Errorf("update proxy upstream %s: %w", route.Domain, err)
		}
		route.UpstreamUrl = updated.UpstreamUrl
	}
	command, err := proxypkg.BuildCommand(proxypkg.Target{
		Domain:     route.Domain,
		Upstream:   route.UpstreamUrl,
		TLSEnabled: route.TlsEnabled,
		ProxyType:  route.ProxyType,
	})
	if err != nil {
		_, _ = r.queries.MarkProxyRouteFailed(ctx, route.ID)
		return fmt.Errorf("build proxy route %s: %w", route.Domain, err)
	}

	r.append(ctx, deployment, "system", "Applying proxy route "+route.Domain)
	output, err := client.Run(ctx, command)
	if strings.TrimSpace(output) != "" {
		r.append(ctx, deployment, "stdout", output)
	}
	if err != nil {
		_, _ = r.queries.MarkProxyRouteFailed(ctx, route.ID)
		return fmt.Errorf("apply proxy route %s: %w", route.Domain, err)
	}
	if _, err := r.queries.MarkProxyRouteApplied(ctx, route.ID); err != nil {
		return fmt.Errorf("mark proxy route applied: %w", err)
	}
	return nil
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
