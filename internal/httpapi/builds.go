package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"deploy-manager/internal/db"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type completeBuildRunRequest struct {
	Status       string `json:"status"`
	ImageRef     string `json:"image_ref"`
	ImageDigest  string `json:"image_digest"`
	ExternalURL  string `json:"external_url"`
	ErrorMessage string `json:"error_message"`
}

func (s Server) listBuildRuns(w http.ResponseWriter, r *http.Request) {
	limit, err := deploymentHistoryLimit(r.URL.Query().Get("limit"))
	if err != nil {
		writeError(w, err)
		return
	}
	builds, err := s.queries.ListBuildRuns(r.Context(), limit)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, builds)
}

func (s Server) completeBuildRun(w http.ResponseWriter, r *http.Request) {
	buildID, err := parseUUIDParam(r, "buildID")
	if err != nil {
		writeError(w, err)
		return
	}
	var request completeBuildRunRequest
	if err := readJSON(w, r, &request); err != nil {
		writeError(w, err)
		return
	}
	input, err := normalizeCompleteBuildRun(buildID, request)
	if err != nil {
		writeError(w, err)
		return
	}
	build, err := s.queries.CompleteBuildRun(r.Context(), input)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, notFoundError("build not found"))
			return
		}
		writeError(w, err)
		return
	}
	s.audit(r, "build.complete", "build", uuidString(build.ID), build.Repository, map[string]any{
		"provider":  build.Provider,
		"status":    build.Status,
		"branch":    build.Branch,
		"image_ref": build.ImageRef.String,
	})

	deployments := s.autoDeploy(r, build)

	writeJSON(w, http.StatusOK, map[string]any{
		"build":       build,
		"deployments": deployments,
	})
}

// autoDeploy creates and enqueues deployments for every application whose
// repository+branch matches a successfully completed build. This is the
// "Vercel loop": build finishes on ephemeral infra → image pushed to registry
// → deploy-manager pulls and deploys via blue/green.
func (s Server) autoDeploy(r *http.Request, build db.BuildRun) []db.Deployment {
	if build.Status != "succeeded" || !build.ImageRef.Valid || strings.TrimSpace(build.ImageRef.String) == "" {
		return nil
	}
	if build.ApplicationID.Valid {
		return s.autoDeployApplication(r, build)
	}
	applications, err := s.queries.ListApplicationsForBuildComplete(r.Context(), db.ListApplicationsForBuildCompleteParams{
		Branch:     build.Branch,
		Repository: build.Repository,
	})
	if err != nil || len(applications) == 0 {
		return nil
	}
	deployed := make([]db.Deployment, 0, len(applications))
	for _, app := range applications {
		input, err := buildCompleteDeploymentInput(app, build)
		if err != nil {
			continue
		}
		if validateBlueGreenHealthCheck(app.HealthCheckUrl) != nil {
			continue
		}
		deployment, err := s.queries.CreateDeployment(r.Context(), input)
		if err != nil {
			continue
		}
		if err := enqueueDeployment(r.Context(), s.queue, s.queries, deployment); err != nil {
			s.audit(r, "build.auto_deploy_failed", "deployment", uuidString(deployment.ID), app.Name, map[string]any{
				"build_id": uuidString(build.ID),
				"error":    errorString(err),
			})
			continue
		}
		s.audit(r, "build.auto_deploy", "deployment", uuidString(deployment.ID), app.Name, map[string]any{
			"build_id":  uuidString(build.ID),
			"image_ref": build.ImageRef.String,
		})
		deployed = append(deployed, deployment)
	}
	return deployed
}

func (s Server) autoDeployApplication(r *http.Request, build db.BuildRun) []db.Deployment {
	app, err := s.queries.GetApplication(r.Context(), build.ApplicationID)
	if err != nil || !app.GithubAutoDeploy {
		return nil
	}
	if validateBlueGreenHealthCheck(app.HealthCheckUrl) != nil {
		return nil
	}
	input, err := buildCompleteApplicationDeploymentInput(app, build)
	if err != nil {
		return nil
	}
	deployment, err := s.queries.CreateDeployment(r.Context(), input)
	if err != nil {
		return nil
	}
	if err := enqueueDeployment(r.Context(), s.queue, s.queries, deployment); err != nil {
		s.audit(r, "build.auto_deploy_failed", "deployment", uuidString(deployment.ID), app.Name, map[string]any{
			"build_id": uuidString(build.ID),
			"error":    errorString(err),
		})
		return nil
	}
	s.audit(r, "build.auto_deploy", "deployment", uuidString(deployment.ID), app.Name, map[string]any{
		"build_id":  uuidString(build.ID),
		"image_ref": build.ImageRef.String,
	})
	return []db.Deployment{deployment}
}

func buildCompleteDeploymentInput(app db.ListApplicationsForBuildCompleteRow, build db.BuildRun) (db.CreateDeploymentParams, error) {
	return normalizeCreateDeployment(db.CreateDeploymentParams{
		ApplicationID: app.ID,
		Trigger:       "connector_sync",
		Strategy:      "blue_green",
		CommitSha:     build.CommitSha,
		ImageRef:      build.ImageRef,
		ImageDigest:   build.ImageDigest,
		Actor:         blankStringAsText("build:" + uuidString(build.ID)),
	})
}

func buildCompleteApplicationDeploymentInput(app db.Application, build db.BuildRun) (db.CreateDeploymentParams, error) {
	return normalizeCreateDeployment(db.CreateDeploymentParams{
		ApplicationID: app.ID,
		Trigger:       "connector_sync",
		Strategy:      "blue_green",
		CommitSha:     build.CommitSha,
		ImageRef:      build.ImageRef,
		ImageDigest:   build.ImageDigest,
		Actor:         blankStringAsText("build:" + uuidString(build.ID)),
	})
}

func normalizeCompleteBuildRun(id pgtype.UUID, request completeBuildRunRequest) (db.CompleteBuildRunParams, error) {
	status := strings.TrimSpace(request.Status)
	if status == "" {
		status = "succeeded"
	}
	if status != "succeeded" && status != "failed" && status != "cancelled" {
		return db.CompleteBuildRunParams{}, validationError("build status must be succeeded, failed, or cancelled")
	}
	imageRef := strings.TrimSpace(request.ImageRef)
	imageDigest := strings.TrimSpace(request.ImageDigest)
	externalURL := strings.TrimSpace(request.ExternalURL)
	errorMessage := strings.TrimSpace(request.ErrorMessage)
	if status == "succeeded" && imageRef == "" {
		return db.CompleteBuildRunParams{}, validationError("image_ref is required when build status is succeeded")
	}
	if imageRef != "" && !imageRefPattern.MatchString(imageRef) {
		return db.CompleteBuildRunParams{}, validationError("image_ref must be a non-empty image reference without whitespace or control characters")
	}
	if imageDigest != "" && !imageDigestPattern.MatchString(imageDigest) {
		return db.CompleteBuildRunParams{}, validationError("image_digest must be a sha256 digest")
	}
	if externalURL != "" && (!strings.HasPrefix(externalURL, "https://") || strings.ContainsAny(externalURL, "\r\n\t") || strings.Contains(externalURL, "@")) {
		return db.CompleteBuildRunParams{}, validationError("external_url must be an https URL without credentials or control characters")
	}
	if errorMessage != "" && (len(errorMessage) > 512 || strings.ContainsAny(errorMessage, "\r\n\t")) {
		return db.CompleteBuildRunParams{}, validationError("error_message must be 512 characters or fewer without control characters")
	}
	return db.CompleteBuildRunParams{
		ID:           id,
		Status:       status,
		ImageRef:     blankStringAsText(imageRef),
		ImageDigest:  blankStringAsText(imageDigest),
		ExternalUrl:  blankStringAsText(externalURL),
		ErrorMessage: blankStringAsText(errorMessage),
	}, nil
}
