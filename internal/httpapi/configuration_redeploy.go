package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"deploy-manager/internal/db"

	"github.com/jackc/pgx/v5/pgtype"
)

const (
	configurationRedeployQueued             = "queued"
	configurationRedeploySkipped            = "skipped"
	configurationRedeployFailed             = "failed"
	configurationRedeployCurrent            = "configuration_current"
	configurationRedeployInProgress         = "deployment_in_progress"
	configurationRedeploySourceUnavailable  = "source_unavailable"
	configurationRedeploySourceNotImmutable = "source_not_immutable"
	configurationRedeployInvalid            = "invalid_configuration"
	configurationRedeployCreationFailed     = "creation_failed"
	configurationRedeployEnqueueFailed      = "enqueue_failed"
)

type configurationRedeploySource struct {
	ApplicationID           pgtype.UUID
	ApplicationName         string
	SourceDeploymentID      pgtype.UUID
	CommitSHA               pgtype.Text
	ImageRef                pgtype.Text
	ImageDigest             pgtype.Text
	SourceRepositoryURL     pgtype.Text
	SourceBranch            pgtype.Text
	ConfiguredRepositoryURL pgtype.Text
	ConfiguredBranch        string
}

type configurationRedeployCreation struct {
	source        configurationRedeploySource
	deployment    db.Deployment
	skippedReason string
}

type configurationRedeployResult struct {
	ApplicationID   string `json:"application_id"`
	ApplicationName string `json:"application_name"`
	Status          string `json:"status"`
	Reason          string `json:"reason,omitempty"`
	DeploymentID    string `json:"deployment_id,omitempty"`
}

type configurationRedeployResponse struct {
	State       string                        `json:"state"`
	Deployments []db.Deployment               `json:"deployments"`
	Results     []configurationRedeployResult `json:"results"`
	Queued      int                           `json:"queued"`
	Skipped     int                           `json:"skipped"`
	Failed      int                           `json:"failed"`
}

func (s Server) redeployApplicationConfiguration(w http.ResponseWriter, r *http.Request) {
	applicationID, err := parseUUIDParam(r, "applicationID")
	if err != nil {
		writeError(w, err)
		return
	}
	creation, err := s.createConfigurationRedeployment(r.Context(), applicationID, auditActor(r))
	if err != nil {
		writeError(w, err)
		return
	}
	switch creation.skippedReason {
	case configurationRedeployCurrent:
		writeError(w, validationError("application configuration is already current"))
		return
	case configurationRedeployInProgress:
		writeError(w, validationError("application already has a queued or running deployment"))
		return
	}

	if err := enqueueDeployment(r.Context(), s.queue, s.queries, creation.deployment); err != nil {
		s.audit(r, "deployment.configuration_redeploy_queue_failed", "deployment", uuidString(creation.deployment.ID), creation.source.ApplicationName, configurationRedeployFailureMetadata(creation.source, creation.deployment, err))
		writeError(w, err)
		return
	}
	s.audit(r, "deployment.configuration_redeploy", "deployment", uuidString(creation.deployment.ID), creation.source.ApplicationName, configurationRedeployMetadata(creation.source, creation.deployment))
	result := configurationRedeployResultFor(creation.source, creation.deployment, configurationRedeployQueued, "")
	response := newConfigurationRedeployResponse([]db.Deployment{creation.deployment}, []configurationRedeployResult{result})
	writeJSON(w, http.StatusAccepted, response)
}

func (s Server) redeployProjectConfiguration(w http.ResponseWriter, r *http.Request) {
	projectID, err := parseUUIDParam(r, "projectID")
	if err != nil {
		writeError(w, err)
		return
	}
	if _, err := s.queries.GetProject(r.Context(), projectID); err != nil {
		writeError(w, applicationLookupError(err, "project not found"))
		return
	}
	candidates, err := s.queries.ListProjectConfigurationRedeployCandidates(r.Context(), projectID)
	if err != nil {
		writeError(w, err)
		return
	}

	deployments := make([]db.Deployment, 0, len(candidates))
	results := make([]configurationRedeployResult, 0, len(candidates))
	actor := auditActor(r)
	for _, candidate := range candidates {
		creation, err := s.createConfigurationRedeployment(r.Context(), candidate.ApplicationID, actor)
		if !creation.source.ApplicationID.Valid {
			creation.source.ApplicationID = candidate.ApplicationID
			creation.source.ApplicationName = candidate.ApplicationName
		}
		if err != nil {
			reason := configurationRedeployFailureReason(err)
			results = append(results, configurationRedeployResultFor(creation.source, db.Deployment{}, configurationRedeployFailed, reason))
			s.audit(r, "deployment.configuration_redeploy_prepare_failed", "application", uuidString(creation.source.ApplicationID), creation.source.ApplicationName, map[string]any{"reason": reason, "error": errorString(err)})
			if reason == configurationRedeployCreationFailed {
				slog.Error("prepare configuration redeploy", "application_id", uuidString(creation.source.ApplicationID), "error", err)
			}
			continue
		}
		if creation.skippedReason != "" {
			results = append(results, configurationRedeployResultFor(creation.source, db.Deployment{}, configurationRedeploySkipped, creation.skippedReason))
			continue
		}
		if err := enqueueDeployment(r.Context(), s.queue, s.queries, creation.deployment); err != nil {
			results = append(results, configurationRedeployResultFor(creation.source, creation.deployment, configurationRedeployFailed, configurationRedeployEnqueueFailed))
			s.audit(r, "deployment.configuration_redeploy_queue_failed", "deployment", uuidString(creation.deployment.ID), creation.source.ApplicationName, configurationRedeployFailureMetadata(creation.source, creation.deployment, err))
			continue
		}
		deployments = append(deployments, creation.deployment)
		results = append(results, configurationRedeployResultFor(creation.source, creation.deployment, configurationRedeployQueued, ""))
		s.audit(r, "deployment.configuration_redeploy", "deployment", uuidString(creation.deployment.ID), creation.source.ApplicationName, configurationRedeployMetadata(creation.source, creation.deployment))
	}

	response := newConfigurationRedeployResponse(deployments, results)
	status := http.StatusAccepted
	if response.Failed > 0 {
		status = http.StatusMultiStatus
	} else if response.Queued == 0 {
		status = http.StatusOK
	}
	writeJSON(w, status, response)
}

func (s Server) createConfigurationRedeployment(ctx context.Context, applicationID pgtype.UUID, actor string) (configurationRedeployCreation, error) {
	tx, err := s.tx.Begin(ctx)
	if err != nil {
		return configurationRedeployCreation{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	queries := s.queries.WithTx(tx)
	application, err := queries.GetApplicationForUpdate(ctx, applicationID)
	if err != nil {
		return configurationRedeployCreation{}, applicationLookupError(err, "application not found")
	}
	candidate, err := queries.GetApplicationConfigurationRedeployCandidate(ctx, applicationID)
	if err != nil {
		return configurationRedeployCreation{}, applicationLookupError(err, "application not found")
	}
	creation := configurationRedeployCreation{source: configurationRedeploySource{
		ApplicationID:           candidate.ApplicationID,
		ApplicationName:         candidate.ApplicationName,
		SourceDeploymentID:      candidate.SourceDeploymentID,
		CommitSHA:               candidate.SourceCommitSha,
		ImageRef:                candidate.SourceImageRef,
		ImageDigest:             candidate.SourceImageDigest,
		SourceRepositoryURL:     candidate.SourceRepositoryUrl,
		SourceBranch:            candidate.SourceBranch,
		ConfiguredRepositoryURL: application.RepositoryUrl,
		ConfiguredBranch:        application.Branch,
	}}
	if !candidate.RedeployRequired.Valid || !candidate.RedeployRequired.Bool {
		creation.skippedReason = configurationRedeployCurrent
		return creation, nil
	}
	if candidate.DeploymentInProgress {
		creation.skippedReason = configurationRedeployInProgress
		return creation, nil
	}

	input, err := configurationRedeployInput(creation.source, actor)
	if err != nil {
		return creation, err
	}
	if input.Strategy != "blue_green" {
		return creation, validationError("deployment strategy must be blue_green")
	}
	if err := validateDeploymentSource(application, input.ImageRef); err != nil {
		return creation, err
	}
	if err := validateBlueGreenDeploymentTarget(application); err != nil {
		return creation, err
	}
	creation.deployment, err = queries.CreateDeployment(ctx, input)
	if err != nil {
		err = createDeploymentError(err)
		if isDeploymentInProgressError(err) {
			creation.skippedReason = configurationRedeployInProgress
			return creation, nil
		}
		return creation, err
	}
	if err := tx.Commit(ctx); err != nil {
		return creation, err
	}
	return creation, nil
}

func configurationRedeployInput(source configurationRedeploySource, actor string) (db.CreateDeploymentParams, error) {
	if !source.SourceDeploymentID.Valid {
		return db.CreateDeploymentParams{}, validationError("application has no active successful deployment to redeploy")
	}

	commitSHA := source.CommitSHA
	imageRef := source.ImageRef
	imageDigest := source.ImageDigest
	if configurationRedeploySourceChanged(source) {
		commitSHA = pgtype.Text{}
		imageRef = pgtype.Text{}
		imageDigest = pgtype.Text{}
	} else if imageRef.Valid && strings.TrimSpace(imageRef.String) != "" {
		var err error
		imageRef, imageDigest, err = immutableConfigurationImage(imageRef, imageDigest)
		if err != nil {
			return db.CreateDeploymentParams{}, err
		}
	}

	input, err := normalizeCreateDeployment(db.CreateDeploymentParams{
		ApplicationID: source.ApplicationID,
		Trigger:       "manual",
		Strategy:      "blue_green",
		CommitSha:     commitSHA,
		ImageRef:      imageRef,
		ImageDigest:   imageDigest,
		Actor:         blankStringAsText(actor),
	})
	if err != nil {
		return db.CreateDeploymentParams{}, err
	}
	if !configurationRedeploySourceChanged(source) && !input.CommitSha.Valid && !input.ImageRef.Valid {
		return db.CreateDeploymentParams{}, validationError("active deployment does not have a pinned source commit or image")
	}
	return input, nil
}

func immutableConfigurationImage(imageRef pgtype.Text, imageDigest pgtype.Text) (pgtype.Text, pgtype.Text, error) {
	ref := strings.TrimSpace(imageRef.String)
	digest := strings.TrimSpace(imageDigest.String)
	base, refDigest, hasRefDigest := strings.Cut(ref, "@")
	if hasRefDigest && !imageDigestPattern.MatchString(refDigest) {
		return pgtype.Text{}, pgtype.Text{}, validationError("active image reference has an invalid digest")
	}
	if digest == "" {
		return pgtype.Text{String: ref, Valid: true}, pgtype.Text{}, nil
	}
	if digest != "" && !imageDigestPattern.MatchString(digest) {
		return pgtype.Text{}, pgtype.Text{}, validationError("active image has an invalid digest")
	}
	if hasRefDigest && digest != "" && refDigest != digest {
		return pgtype.Text{}, pgtype.Text{}, validationError("active image reference and digest do not match")
	}
	if strings.TrimSpace(base) == "" {
		return pgtype.Text{}, pgtype.Text{}, validationError("active image reference is invalid")
	}
	pinned := pgtype.Text{String: base + "@" + digest, Valid: true}
	if !validImageRef(pinned.String) {
		return pgtype.Text{}, pgtype.Text{}, validationError("active image reference is invalid")
	}
	return pinned, pgtype.Text{String: digest, Valid: true}, nil
}

func configurationRedeploySourceChanged(source configurationRedeploySource) bool {
	configuredRepository := strings.TrimSpace(source.ConfiguredRepositoryURL.String)
	sourceRepository := strings.TrimSpace(source.SourceRepositoryURL.String)
	if configuredRepository != sourceRepository {
		return true
	}
	if configuredRepository == "" {
		return false
	}
	return strings.TrimSpace(source.ConfiguredBranch) != strings.TrimSpace(source.SourceBranch.String)
}

func configurationRedeployResultFor(source configurationRedeploySource, deployment db.Deployment, status string, reason string) configurationRedeployResult {
	result := configurationRedeployResult{
		ApplicationID:   uuidString(source.ApplicationID),
		ApplicationName: source.ApplicationName,
		Status:          status,
		Reason:          reason,
	}
	if deployment.ID.Valid {
		result.DeploymentID = uuidString(deployment.ID)
	}
	return result
}

func newConfigurationRedeployResponse(deployments []db.Deployment, results []configurationRedeployResult) configurationRedeployResponse {
	response := configurationRedeployResponse{Deployments: deployments, Results: results, State: "current"}
	allInProgress := len(results) > 0
	for _, result := range results {
		switch result.Status {
		case configurationRedeployQueued:
			response.Queued++
		case configurationRedeploySkipped:
			response.Skipped++
		default:
			response.Failed++
		}
		if result.Reason != configurationRedeployInProgress {
			allInProgress = false
		}
	}
	switch {
	case response.Queued > 0 && (response.Skipped > 0 || response.Failed > 0):
		response.State = "partial"
	case response.Queued > 0:
		response.State = "queued"
	case response.Failed > 0:
		response.State = "failed"
	case allInProgress:
		response.State = "in_progress"
	case response.Skipped > 0:
		response.State = "skipped"
	}
	return response
}

func configurationRedeployFailureReason(err error) string {
	var notFound notFoundError
	if errors.As(err, &notFound) {
		return "application_not_found"
	}
	var validation validationError
	if errors.As(err, &validation) {
		message := validation.Error()
		switch {
		case strings.Contains(message, "active image"):
			return configurationRedeploySourceNotImmutable
		case strings.Contains(message, "active successful deployment"), strings.Contains(message, "pinned source commit or image"):
			return configurationRedeploySourceUnavailable
		default:
			return configurationRedeployInvalid
		}
	}
	return configurationRedeployCreationFailed
}

func configurationRedeployMetadata(source configurationRedeploySource, deployment db.Deployment) map[string]any {
	metadata := deploymentQueueMetadata(deployment)
	metadata["reason"] = "configuration_changed"
	metadata["source_deployment_id"] = uuidString(source.SourceDeploymentID)
	metadata["source_changed"] = configurationRedeploySourceChanged(source)
	return metadata
}

func configurationRedeployFailureMetadata(source configurationRedeploySource, deployment db.Deployment, cause error) map[string]any {
	metadata := configurationRedeployMetadata(source, deployment)
	metadata["status"] = "failed"
	metadata["error"] = errorString(cause)
	return metadata
}
