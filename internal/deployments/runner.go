package deployments

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"deploy-manager/internal/auditlog"
	"deploy-manager/internal/connectors"
	"deploy-manager/internal/db"
	"deploy-manager/internal/notifications"
	proxypkg "deploy-manager/internal/proxy"
	"deploy-manager/internal/sshutil"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type Runner struct {
	queries runnerQueries
	logs    *LogBus
	runtime RuntimeVariableSource

	notifier notifications.Notifier
}

const (
	maxDeploymentLogMessageLength = 32768
	deploymentLogTruncatedMarker  = "\n...[truncated]"
)

type runnerQueries interface {
	AppendAuditEvent(context.Context, db.AppendAuditEventParams) (db.AuditEvent, error)
	AppendDeploymentLog(context.Context, db.AppendDeploymentLogParams) (db.DeploymentLog, error)
	GetDeploymentTarget(context.Context, pgtype.UUID) (db.GetDeploymentTargetRow, error)
	ListProxyRouteTargetsForApplication(context.Context, db.ListProxyRouteTargetsForApplicationParams) ([]db.ListProxyRouteTargetsForApplicationRow, error)
	MarkProxyRouteApplied(context.Context, pgtype.UUID) (db.ProxyRoute, error)
	MarkProxyRouteFailed(context.Context, pgtype.UUID) (db.ProxyRoute, error)
	StartQueuedDeployment(context.Context, pgtype.UUID) (db.Deployment, error)
	UpdateApplicationStatus(context.Context, db.UpdateApplicationStatusParams) (db.Application, error)
	UpdateDeploymentStatus(context.Context, db.UpdateDeploymentStatusParams) (db.Deployment, error)
}

type RuntimeVariableSource interface {
	RuntimeVariables(context.Context, connectors.RuntimeVariableScope) ([]connectors.RuntimeVariable, error)
}

func NewRunner(queries runnerQueries, logs *LogBus, notifier notifications.Notifier, runtime RuntimeVariableSource) Runner {
	if notifier == nil {
		notifier = notifications.Noop{}
	}
	return Runner{queries: queries, logs: logs, notifier: notifier, runtime: runtime}
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
		Version: target.CommitSha,
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
		Version: target.CommitSha,
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
	if !target.SshKeyPath.Valid || strings.TrimSpace(target.SshKeyPath.String) == "" {
		return fmt.Errorf("server %s has no ssh key path configured", target.ServerName)
	}

	signer, err := sshutil.LoadSigner(target.SshKeyPath.String)
	if err != nil {
		return fmt.Errorf("load ssh key: %w", err)
	}

	client := sshutil.NewClient(target.Hostname, target.SshPort, target.SshUser, signer)
	r.append(ctx, deployment, "system", fmt.Sprintf("Connecting to %s@%s", target.SshUser, target.Hostname))
	r.append(ctx, deployment, "system", fmt.Sprintf("Strategy: %s", target.Strategy))

	var variables []connectors.RuntimeVariable
	if r.runtime != nil {
		var runtimeErr error
		variables, runtimeErr = r.runtime.RuntimeVariables(ctx, runtimeScope(target))
		if runtimeErr != nil {
			return fmt.Errorf("sync runtime variables: %w", runtimeErr)
		}
		r.append(ctx, deployment, "system", fmt.Sprintf("Runtime variables synced: %d", validRuntimeVariableCount(variables)))
	}

	steps, err := remoteSteps(target, variables)
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
	if err := r.applyProxyRoutes(ctx, deployment, target, client); err != nil {
		return err
	}

	return nil
}

type remoteRunner interface {
	Run(context.Context, string) (string, error)
}

func (r Runner) applyProxyRoutes(ctx context.Context, deployment db.Deployment, target db.GetDeploymentTargetRow, client remoteRunner) error {
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
		if err := r.applyProxyRoute(ctx, deployment, route, client); err != nil {
			return err
		}
	}
	return nil
}

func (r Runner) applyProxyRoute(ctx context.Context, deployment db.Deployment, route db.ListProxyRouteTargetsForApplicationRow, client remoteRunner) error {
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

func runtimeScope(target db.GetDeploymentTargetRow) connectors.RuntimeVariableScope {
	return connectors.RuntimeVariableScope{
		ApplicationName: target.ApplicationName,
		Project:         strings.TrimSpace(target.DopplerProject.String),
		Config:          strings.TrimSpace(target.DopplerConfig.String),
	}
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
