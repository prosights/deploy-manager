package httpapi

import (
	"io"
	"net/http"
	"path"
	"strings"

	"deploy-manager/internal/db"
	"deploy-manager/internal/deployments"
	"deploy-manager/internal/githubconnector"
	"deploy-manager/internal/githubhook"

	"github.com/jackc/pgx/v5/pgtype"
)

func (s Server) githubWebhook(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 2<<20))
	if err != nil {
		writeError(w, err)
		return
	}
	defer r.Body.Close()

	if !githubhook.VerifySignature(s.github.Secret, body, r.Header.Get("X-Hub-Signature-256")) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid github signature"})
		return
	}
	if s.replays != nil && s.replays.Seen(r.Header.Get("X-GitHub-Delivery")) {
		writeJSON(w, http.StatusAccepted, map[string]any{"ignored": true, "reason": "duplicate_delivery"})
		return
	}

	event, err := normalizeGitHubEvent(r.Header.Get("X-GitHub-Event"))
	if err != nil {
		writeError(w, err)
		return
	}
	if event == "ping" {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
		return
	}
	if event != "push" {
		s.audit(r, "github.event_ignored", "webhook", "github", event, map[string]any{"event": event, "reason": "unsupported_event"})
		writeJSON(w, http.StatusAccepted, map[string]any{"ignored": true, "event": event})
		return
	}

	push, err := githubhook.ParsePush(body)
	if err != nil {
		writeError(w, validationError(err.Error()))
		return
	}
	if push.Deleted {
		s.audit(r, "github.push_ignored", "deployment", "batch", push.Branch, githubIgnoredPushMetadata(push, "branch_deleted"))
		writeJSON(w, http.StatusAccepted, map[string]any{
			"ignored": true,
			"event":   event,
			"reason":  "branch_deleted",
			"branch":  push.Branch,
		})
		return
	}
	if err := validateGitHubPushBranch(push.Branch); err != nil {
		writeError(w, validationError(err.Error()))
		return
	}
	if push.CommitSHA != "" && !deployments.ValidCommitSHA(push.CommitSHA) {
		writeError(w, validationError("commit_sha must be a 7 to 40 character hexadecimal SHA"))
		return
	}

	applications, err := s.queries.ListApplicationsForGitHubPush(r.Context(), db.ListApplicationsForGitHubPushParams{
		Branch:         push.Branch,
		RepositoryUrls: push.Repositories,
	})
	if err != nil {
		writeError(w, err)
		return
	}

	queued := make([]db.Deployment, 0, len(applications))
	builds := make([]db.BuildRun, 0)
	skipped := make([]map[string]any, 0)

	for _, application := range applications {
		if err := validateBlueGreenHealthCheck(application.HealthCheckUrl); err != nil {
			skipped = append(skipped, githubSkipEntry(application, err, push))
			s.auditGitHubSkip(r, application, err, push)
			continue
		}

		if dispatched, ok := s.tryBuildDispatch(r, application, push); ok {
			if dispatched.ID.Valid {
				builds = append(builds, dispatched)
			}
			continue
		}

		if strings.TrimSpace(application.ComposePath) == "" {
			err := validationError("application has no compose_path to build from")
			skipped = append(skipped, githubSkipEntry(application, err, push))
			s.auditGitHubSkip(r, application, err, push)
			continue
		}

		input, err := normalizeCreateDeployment(db.CreateDeploymentParams{
			ApplicationID: application.ID,
			Trigger:       "github_push",
			Strategy:      "blue_green",
			CommitSha:     blankStringAsText(push.CommitSHA),
			Actor:         blankStringAsText(push.Actor),
		})
		if err != nil {
			skipped = append(skipped, githubSkipEntry(application, err, push))
			s.auditGitHubSkip(r, application, err, push)
			continue
		}
		deployment, err := s.queries.CreateDeployment(r.Context(), input)
		if err != nil {
			writeError(w, err)
			return
		}
		if err := enqueueDeployment(r.Context(), s.queue, s.queries, deployment); err != nil {
			s.audit(r, "github.queue_failed", "deployment", uuidString(deployment.ID), uuidString(deployment.ApplicationID), githubQueueFailureMetadata(deployment, err))
			writeError(w, err)
			return
		}
		queued = append(queued, deployment)
	}

	writeJSON(w, http.StatusAccepted, map[string]any{
		"branch":      push.Branch,
		"commit_sha":  push.CommitSHA,
		"matched":     len(applications),
		"deployments": queued,
		"builds":      builds,
		"skipped":     skipped,
	})
	s.audit(r, "github.push", "deployment", "batch", push.Branch, map[string]any{"matched": len(applications), "commit_sha": push.CommitSHA})
}

// tryBuildDispatch attempts to dispatch a GitHub Actions build for the
// application. Access-only repositories fall back to source-build-on-target;
// configured image builds stay on GitHub Actions.
func (s Server) tryBuildDispatch(r *http.Request, application db.ListApplicationsForGitHubPushRow, push githubhook.Push) (db.BuildRun, bool) {
	if s.github.App == nil {
		return db.BuildRun{}, false
	}
	accounts, err := s.queries.ListConnectorAccounts(r.Context())
	if err != nil {
		return db.BuildRun{}, false
	}
	repoName := githubRepoFromURLs(push.Repositories)
	if repoName == "" {
		return db.BuildRun{}, false
	}
	hasOwnedTarget := false
	sourceMatch := false
	for _, account := range accounts {
		if account.Provider != "github" || !account.Enabled {
			continue
		}
		repo, owned, err := githubConnectorBuildTarget(account.Config, repoName, push.Branch, application, push.ChangedPaths)
		if err != nil {
			s.auditGitHubSkip(r, application, err, push)
			return db.BuildRun{}, true
		}
		if !owned {
			continue
		}
		hasOwnedTarget = true
		if repo.Repository == "" {
			continue
		}
		if repo.InstallationID == "" {
			s.auditGitHubSkip(r, application, validationError("github repository requires installation_id before builds can be dispatched"), push)
			return db.BuildRun{}, true
		}
		request := githubPushBuildRequest(repo, push)
		if strings.TrimSpace(request.Inputs["image_ref"]) == "" {
			sourceMatch = true
			continue
		}
		if err := validateGitHubBuildDispatchRequest(request); err != nil {
			s.auditGitHubSkip(r, application, err, push)
			return db.BuildRun{}, true
		}
		build, err := s.queries.CreateBuildRun(r.Context(), db.CreateBuildRunParams{
			Provider:      "github_actions",
			ConnectorID:   account.ID,
			ApplicationID: application.ID,
			Repository:    repo.Repository,
			Branch:        repo.Branch,
			WorkflowID:    request.WorkflowID,
			CommitSha:     blankStringAsText(push.CommitSHA),
		})
		if err != nil {
			return db.BuildRun{}, true
		}
		inputs := githubBuildWorkflowInputs(request.Inputs, build)
		if err := s.github.App.DispatchWorkflow(r.Context(), repo.InstallationID, repo.Repository, request.WorkflowID, repo.Branch, inputs); err != nil {
			failedBuild, _ := s.queries.CompleteBuildRun(r.Context(), db.CompleteBuildRunParams{
				ID:           build.ID,
				Status:       "failed",
				ErrorMessage: blankStringAsText(buildErrorMessage(err)),
			})
			if failedBuild.ID.Valid {
				return failedBuild, true
			}
			return build, true
		}
		s.audit(r, "github.build_dispatch", "build", uuidString(build.ID), repo.Repository, map[string]any{
			"connector_id": uuidString(account.ID),
			"branch":       push.Branch,
			"commit_sha":   push.CommitSHA,
			"workflow_id":  request.WorkflowID,
		})
		return build, true
	}
	if sourceMatch {
		return db.BuildRun{}, false
	}
	if hasOwnedTarget || !applicationMatchesChangedPaths(application, push.ChangedPaths) {
		return db.BuildRun{}, true
	}
	return db.BuildRun{}, false
}

func githubConnectorBuildTarget(raw []byte, repoName string, branch string, application db.ListApplicationsForGitHubPushRow, changedPaths []string) (githubconnector.Repository, bool, error) {
	repositories, err := githubConnectorRepositories(raw, repoName, branch)
	if err != nil {
		return githubconnector.Repository{}, false, nil
	}
	for _, applicationSpecific := range []bool{true, false} {
		for _, repository := range repositories {
			isApplicationSpecific := repository.ApplicationID != "" || repository.ApplicationName != ""
			if isApplicationSpecific != applicationSpecific || !repositoryTargetsApplication(repository, application.ID, application.Name) {
				continue
			}
			if len(repository.PathFilters) == 0 && !isApplicationSpecific {
				repository.PathFilters = applicationPathFilters(application.ComposePath)
			}
			if !repositoryMatchesChangedPaths(repository, changedPaths) {
				return githubconnector.Repository{}, true, nil
			}
			return repository, true, nil
		}
	}
	return githubconnector.Repository{}, false, nil
}

func applicationMatchesChangedPaths(application db.ListApplicationsForGitHubPushRow, changedPaths []string) bool {
	return repositoryMatchesChangedPaths(githubconnector.Repository{PathFilters: applicationPathFilters(application.ComposePath)}, changedPaths)
}

func applicationPathFilters(composePath string) []string {
	root := path.Dir(strings.Trim(strings.TrimSpace(composePath), "/"))
	if root == "." {
		return nil
	}
	return []string{root + "/**"}
}

func repositoryTargetsApplication(repository githubconnector.Repository, applicationID pgtype.UUID, applicationName string) bool {
	if repository.ApplicationID != "" {
		return repository.ApplicationID == uuidString(applicationID)
	}
	if repository.ApplicationName != "" {
		return strings.EqualFold(repository.ApplicationName, applicationName)
	}
	return true
}

func repositoryMatchesChangedPaths(repository githubconnector.Repository, changedPaths []string) bool {
	if len(repository.PathFilters) == 0 {
		return true
	}
	if len(changedPaths) == 0 {
		return false
	}
	for _, changedPath := range changedPaths {
		changedPath = strings.Trim(strings.TrimSpace(changedPath), "/")
		for _, filter := range repository.PathFilters {
			if pathFilterMatches(filter, changedPath) {
				return true
			}
		}
	}
	return false
}

func pathFilterMatches(filter string, changedPath string) bool {
	filter = strings.Trim(strings.TrimSpace(filter), "/")
	if filter == "" || changedPath == "" {
		return false
	}
	filter = strings.TrimSuffix(filter, "/**")
	filter = strings.TrimSuffix(filter, "/*")
	if filter == "" {
		return true
	}
	return changedPath == filter || strings.HasPrefix(changedPath, filter+"/")
}

func githubPushBuildRequest(repo githubconnector.Repository, push githubhook.Push) githubBuildDispatchRequest {
	inputs := map[string]string{}
	if strings.TrimSpace(push.CommitSHA) != "" {
		inputs["commit_sha"] = strings.TrimSpace(push.CommitSHA)
	}
	request := fillGitHubBuildDefaults(githubBuildDispatchRequest{
		Repository: repo.Repository,
		Branch:     repo.Branch,
		Inputs:     inputs,
	}, repo)
	expandGitHubBuildInputTemplates(request.Inputs, push.CommitSHA)
	return request
}

// githubRepoFromURLs extracts the owner/repo from the first URL in the list.
func githubRepoFromURLs(urls []string) string {
	for _, u := range urls {
		u = strings.TrimSuffix(strings.TrimSpace(u), ".git")
		if idx := strings.LastIndex(u, "/"); idx > 0 {
			prefix := u[:idx]
			name := u[idx+1:]
			if ownerIdx := strings.LastIndex(prefix, "/"); ownerIdx >= 0 {
				return prefix[ownerIdx+1:] + "/" + name
			}
			if colonIdx := strings.LastIndex(prefix, ":"); colonIdx >= 0 {
				return prefix[colonIdx+1:] + "/" + name
			}
		}
	}
	return ""
}

func githubSkipEntry(application db.ListApplicationsForGitHubPushRow, err error, push githubhook.Push) map[string]any {
	return map[string]any{
		"application_id": uuidString(application.ID),
		"reason":         errorString(err),
	}
}

func (s Server) auditGitHubSkip(r *http.Request, application db.ListApplicationsForGitHubPushRow, err error, push githubhook.Push) {
	s.audit(r, "github.push_skipped", "deployment", uuidString(application.ID), application.Name, map[string]any{
		"reason":     "not_deployable",
		"error":      errorString(err),
		"branch":     push.Branch,
		"commit_sha": push.CommitSHA,
	})
}

func githubIgnoredPushMetadata(push githubhook.Push, reason string) map[string]any {
	return map[string]any{
		"reason":     reason,
		"branch":     push.Branch,
		"commit_sha": push.CommitSHA,
		"actor":      push.Actor,
	}
}

func githubQueueFailureMetadata(deployment db.Deployment, cause error) map[string]any {
	metadata := deploymentQueueFailureMetadata(deployment, cause)
	metadata["source"] = "github_push"
	return metadata
}

func validateGitHubPushBranch(branch string) error {
	return deployments.ValidateGitRefName(branch)
}

func normalizeGitHubEvent(value string) (string, error) {
	if strings.ContainsAny(value, "\r\n\t") {
		return "", validationError("github event header cannot contain control characters")
	}
	event := strings.ToLower(strings.TrimSpace(value))
	if event == "" {
		return "", validationError("github event header is required")
	}
	return event, nil
}
