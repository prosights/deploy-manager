package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"deploy-manager/internal/db"
	"deploy-manager/internal/deployments"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	defaultDeploymentHistoryLimit int32 = 100
	maxDeploymentHistoryLimit     int32 = 500
	deploymentInProgressMessage         = "application already has a queued or running deployment"
)

var imageDigestPattern = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
var imageRefPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,511}$`)

func (s Server) listDeployments(w http.ResponseWriter, r *http.Request) {
	limit, err := deploymentHistoryLimit(r.URL.Query().Get("limit"))
	if err != nil {
		writeError(w, err)
		return
	}
	deployments, err := s.queries.ListDeployments(r.Context(), limit)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, deployments)
}

func deploymentHistoryLimit(value string) (int32, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return defaultDeploymentHistoryLimit, nil
	}
	limit, err := strconv.ParseInt(value, 10, 32)
	if err != nil || limit < 1 {
		return 0, validationError("deployment history limit must be a positive integer")
	}
	if limit > int64(maxDeploymentHistoryLimit) {
		return maxDeploymentHistoryLimit, nil
	}
	return int32(limit), nil
}

func (s Server) createDeployment(w http.ResponseWriter, r *http.Request) {
	var input db.CreateDeploymentParams
	if err := readJSON(w, r, &input); err != nil {
		writeError(w, err)
		return
	}
	input, err := normalizeCreateDeployment(input)
	if err != nil {
		writeError(w, err)
		return
	}
	if err := s.validateDeploymentTarget(r.Context(), input.ApplicationID, input.Strategy, input.ImageRef); err != nil {
		writeError(w, err)
		return
	}

	deployment, err := s.queries.CreateDeployment(r.Context(), input)
	if err != nil {
		writeError(w, createDeploymentError(err))
		return
	}
	if err := enqueueDeployment(r.Context(), s.queue, s.queries, deployment); err != nil {
		s.audit(r, "deployment.queue_failed", "deployment", uuidString(deployment.ID), uuidString(deployment.ApplicationID), deploymentQueueFailureMetadata(deployment, err))
		writeError(w, err)
		return
	}
	s.audit(r, "deployment.queue", "deployment", uuidString(deployment.ID), uuidString(deployment.ApplicationID), deploymentQueueMetadata(deployment))
	writeJSON(w, http.StatusAccepted, deployment)
}

func createDeploymentError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return notFoundError("application not found")
	}
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) && postgresError.Code == "23505" && postgresError.ConstraintName == "deployments_one_in_progress_per_application" {
		return validationError(deploymentInProgressMessage)
	}
	return err
}

func isDeploymentInProgressError(err error) bool {
	var validation validationError
	return errors.As(err, &validation) && validation.Error() == deploymentInProgressMessage
}

func (s Server) cancelDeployment(w http.ResponseWriter, r *http.Request) {
	deploymentID, err := parseUUIDParam(r, "deploymentID")
	if err != nil {
		writeError(w, err)
		return
	}

	deployment, err := s.queries.CancelQueuedDeployment(r.Context(), deploymentID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, validationError("only queued deployments can be cancelled"))
			return
		}
		writeError(w, err)
		return
	}
	s.audit(r, "deployment.cancel", "deployment", uuidString(deployment.ID), uuidString(deployment.ApplicationID), deploymentCancelMetadata(deployment, auditActor(r)))
	writeJSON(w, http.StatusOK, deployment)
}

func (s Server) retryDeployment(w http.ResponseWriter, r *http.Request) {
	deploymentID, err := parseUUIDParam(r, "deploymentID")
	if err != nil {
		writeError(w, err)
		return
	}

	source, err := s.queries.GetDeployment(r.Context(), deploymentID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, notFoundError("deployment not found"))
			return
		}
		writeError(w, err)
		return
	}

	input, err := retryDeploymentInput(source, auditActor(r))
	if err != nil {
		writeError(w, err)
		return
	}
	if err := s.validateDeploymentTarget(r.Context(), input.ApplicationID, input.Strategy, input.ImageRef); err != nil {
		writeError(w, err)
		return
	}
	deployment, err := s.queries.CreateDeployment(r.Context(), input)
	if err != nil {
		writeError(w, createDeploymentError(err))
		return
	}
	if err := enqueueDeployment(r.Context(), s.queue, s.queries, deployment); err != nil {
		s.audit(r, "deployment.retry_queue_failed", "deployment", uuidString(deployment.ID), uuidString(deployment.ApplicationID), deploymentRetryFailureMetadata(source, deployment, err))
		writeError(w, err)
		return
	}
	s.audit(r, "deployment.retry", "deployment", uuidString(deployment.ID), uuidString(deployment.ApplicationID), deploymentRetryMetadata(source, deployment))
	writeJSON(w, http.StatusAccepted, deployment)
}

func (s Server) rollbackApplication(w http.ResponseWriter, r *http.Request) {
	applicationID, err := parseUUIDParam(r, "applicationID")
	if err != nil {
		writeError(w, err)
		return
	}
	application, err := s.queries.GetApplication(r.Context(), applicationID)
	if err != nil {
		writeError(w, createDeploymentError(err))
		return
	}
	slot, err := s.queries.GetStandbyDeploymentSlot(r.Context(), db.GetStandbyDeploymentSlotParams{
		ApplicationID: application.ID,
		ServerID:      application.ServerID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, validationError("no standby blue-green slot is available for rollback"))
			return
		}
		writeError(w, err)
		return
	}
	input, err := normalizeCreateDeployment(db.CreateDeploymentParams{
		ApplicationID: application.ID,
		Trigger:       "rollback",
		Strategy:      "blue_green",
		ImageRef:      pgtype.Text{String: slot.ImageRef, Valid: true},
		ImageDigest:   slot.ImageDigest,
		Actor:         blankStringAsText(auditActor(r)),
	})
	if err != nil {
		writeError(w, err)
		return
	}
	if err := s.validateDeploymentTarget(r.Context(), input.ApplicationID, input.Strategy, input.ImageRef); err != nil {
		writeError(w, err)
		return
	}
	deployment, err := s.queries.CreateDeployment(r.Context(), input)
	if err != nil {
		writeError(w, createDeploymentError(err))
		return
	}
	if err := enqueueDeployment(r.Context(), s.queue, s.queries, deployment); err != nil {
		s.audit(r, "deployment.rollback_queue_failed", "deployment", uuidString(deployment.ID), uuidString(deployment.ApplicationID), deploymentQueueFailureMetadata(deployment, err))
		writeError(w, err)
		return
	}
	s.audit(r, "deployment.rollback", "deployment", uuidString(deployment.ID), application.Name, map[string]any{
		"application_id": uuidString(application.ID),
		"target_color":   slot.Color,
		"image_ref":      slot.ImageRef,
	})
	writeJSON(w, http.StatusAccepted, deployment)
}

func (s Server) listApplicationDeploymentSlots(w http.ResponseWriter, r *http.Request) {
	applicationID, err := parseUUIDParam(r, "applicationID")
	if err != nil {
		writeError(w, err)
		return
	}
	if _, err := s.queries.GetApplication(r.Context(), applicationID); err != nil {
		writeError(w, applicationLookupError(err, "application not found"))
		return
	}
	slots, err := s.queries.ListDeploymentSlotsForApplication(r.Context(), applicationID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, slots)
}

type deploymentStatusUpdater interface {
	UpdateDeploymentStatus(context.Context, db.UpdateDeploymentStatusParams) (db.Deployment, error)
}

func enqueueDeployment(ctx context.Context, queue DeploymentQueue, updater deploymentStatusUpdater, deployment db.Deployment) error {
	if err := queue.Enqueue(ctx, deployment); err != nil {
		return markDeploymentEnqueueFailed(ctx, updater, deployment, err)
	}
	return nil
}

func markDeploymentEnqueueFailed(ctx context.Context, updater deploymentStatusUpdater, deployment db.Deployment, cause error) error {
	_, updateErr := updater.UpdateDeploymentStatus(ctx, db.UpdateDeploymentStatusParams{
		ID:     deployment.ID,
		Status: "failed",
	})
	if updateErr != nil {
		return fmt.Errorf("enqueue deployment: %w; mark failed: %v", cause, updateErr)
	}
	return fmt.Errorf("enqueue deployment: %w", cause)
}

func deploymentCancelMetadata(deployment db.Deployment, actor string) map[string]any {
	metadata := map[string]any{"status": deployment.Status}
	actor = auditIdentityField(actor, "")
	if actor != "" {
		metadata["actor"] = actor
	}
	return metadata
}

func deploymentQueueMetadata(deployment db.Deployment) map[string]any {
	metadata := map[string]any{
		"strategy": deployment.Strategy,
		"trigger":  deployment.Trigger,
	}
	if deployment.CommitSha.Valid {
		metadata["commit_sha"] = deployment.CommitSha.String
	}
	if deployment.Actor.Valid {
		metadata["actor"] = deployment.Actor.String
	}
	return metadata
}

func deploymentQueueFailureMetadata(deployment db.Deployment, cause error) map[string]any {
	metadata := deploymentQueueMetadata(deployment)
	metadata["status"] = "failed"
	metadata["error"] = errorString(cause)
	return metadata
}

func retryDeploymentInput(source db.Deployment, actor string) (db.CreateDeploymentParams, error) {
	if source.Status != "failed" && source.Status != "cancelled" {
		return db.CreateDeploymentParams{}, validationError("only failed or cancelled deployments can be retried")
	}
	return normalizeCreateDeployment(db.CreateDeploymentParams{
		ApplicationID: source.ApplicationID,
		Trigger:       "retry",
		Strategy:      "blue_green",
		CommitSha:     source.CommitSha,
		ImageRef:      source.ImageRef,
		ImageDigest:   source.ImageDigest,
		Actor:         blankStringAsText(actor),
	})
}

func (s Server) validateDeploymentTarget(ctx context.Context, applicationID pgtype.UUID, strategy string, imageRef pgtype.Text) error {
	if strategy != "blue_green" {
		return validationError("deployment strategy must be blue_green")
	}
	application, err := s.queries.GetApplication(ctx, applicationID)
	if err != nil {
		return createDeploymentError(err)
	}
	if err := validateDeploymentSource(application, imageRef); err != nil {
		return err
	}
	return validateBlueGreenDeploymentTarget(application)
}

// validateDeploymentSource enforces that every deployment has a buildable or
// pullable source: either a pinned image_ref (artifact deploy) or a repository
// plus compose path (source deploy built on the target). Without one of these
// there is nothing to run and no rollback point to record.
func validateDeploymentSource(application db.Application, imageRef pgtype.Text) error {
	if imageRef.Valid && strings.TrimSpace(imageRef.String) != "" {
		return nil
	}
	if application.RepositoryUrl.Valid && strings.TrimSpace(application.RepositoryUrl.String) != "" &&
		strings.TrimSpace(application.ComposePath) != "" {
		return nil
	}
	return validationError("deployment requires an image_ref or a repository_url with compose_path so it can be built")
}

func validateBlueGreenDeploymentTarget(application db.Application) error {
	return validateBlueGreenHealthCheck(application.HealthCheckUrl)
}

func validateBlueGreenHealthCheck(healthCheckURL pgtype.Text) error {
	if !healthCheckURL.Valid || !strings.Contains(healthCheckURL.String, "{color}") || !strings.Contains(healthCheckURL.String, "{port}") {
		return validationError("blue_green deployments require a health_check_url with {color} and {port}")
	}
	if err := validateHealthCheckURL(healthCheckURL.String); err != nil {
		return validationError(err.Error())
	}
	return nil
}

func deploymentRetryMetadata(source db.Deployment, deployment db.Deployment) map[string]any {
	metadata := deploymentQueueMetadata(deployment)
	metadata["source_deployment_id"] = uuidString(source.ID)
	metadata["source_status"] = source.Status
	return metadata
}

func deploymentRetryFailureMetadata(source db.Deployment, deployment db.Deployment, cause error) map[string]any {
	metadata := deploymentRetryMetadata(source, deployment)
	metadata["status"] = "failed"
	metadata["error"] = errorString(cause)
	return metadata
}

func normalizeCreateDeployment(input db.CreateDeploymentParams) (db.CreateDeploymentParams, error) {
	input.Trigger = strings.TrimSpace(input.Trigger)
	input.Strategy = strings.TrimSpace(input.Strategy)
	input.CommitSha.String = strings.TrimSpace(input.CommitSha.String)
	input.Actor.String = strings.TrimSpace(input.Actor.String)

	if !input.ApplicationID.Valid {
		return input, validationError("application_id is required")
	}
	if input.Trigger == "" {
		input.Trigger = "manual"
	}
	if !validDeploymentTrigger(input.Trigger) {
		return input, validationError("deployment trigger must be manual, github_push, connector_sync, retry, or rollback")
	}
	if input.Strategy == "" {
		input.Strategy = "blue_green"
	}
	if !validDeploymentStrategy(input.Strategy) {
		return input, validationError("deployment strategy must be blue_green")
	}
	input.CommitSha = blankTextAsNull(input.CommitSha)
	if input.CommitSha.Valid && !deployments.ValidCommitSHA(input.CommitSha.String) {
		return input, validationError("commit_sha must be a 7 to 40 character hexadecimal SHA")
	}
	input.ImageRef = blankTextAsNull(input.ImageRef)
	if input.ImageRef.Valid && !validImageRef(input.ImageRef.String) {
		return input, validationError("image_ref must be a non-empty image reference without whitespace or control characters")
	}
	input.ImageDigest = blankTextAsNull(input.ImageDigest)
	if input.ImageDigest.Valid && !imageDigestPattern.MatchString(input.ImageDigest.String) {
		return input, validationError("image_digest must be a sha256 digest")
	}
	input.Actor = blankTextAsNull(input.Actor)
	if input.Actor.Valid && strings.ContainsAny(input.Actor.String, "\r\n\t") {
		return input, validationError("actor cannot contain control characters")
	}
	return input, nil
}

func validDeploymentTrigger(trigger string) bool {
	switch trigger {
	case "manual", "github_push", "connector_sync", "retry", "rollback":
		return true
	default:
		return false
	}
}

func validImageRef(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 512 {
		return false
	}
	return imageRefPattern.MatchString(value)
}

func validDeploymentStrategy(strategy string) bool {
	return strategy == "blue_green"
}
