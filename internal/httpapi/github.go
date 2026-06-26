package httpapi

import (
	"io"
	"net/http"
	"strings"

	"deploy-manager/internal/db"
	"deploy-manager/internal/deployments"
	"deploy-manager/internal/githubhook"
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
	for _, application := range applications {
		deployment, err := s.queries.CreateDeployment(r.Context(), db.CreateDeploymentParams{
			ApplicationID: application.ID,
			Trigger:       "github_push",
			Strategy:      "rolling",
			CommitSha:     blankStringAsText(push.CommitSHA),
			Actor:         blankStringAsText(push.Actor),
		})
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
	})
	s.audit(r, "github.push", "deployment", "batch", push.Branch, map[string]any{"matched": len(applications), "commit_sha": push.CommitSHA})
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
