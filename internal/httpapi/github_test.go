package httpapi

import (
	"errors"
	"testing"

	"deploy-manager/internal/db"
	"deploy-manager/internal/githubhook"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestGitHubQueueFailureMetadataIncludesSourceAndFailureEvidence(t *testing.T) {
	metadata := githubQueueFailureMetadata(db.Deployment{
		Trigger:   "github_push",
		Strategy:  "rolling",
		CommitSha: pgtype.Text{String: "abc1234", Valid: true},
	}, errors.New("enqueue deployment: redis down"))

	if metadata["source"] != "github_push" || metadata["status"] != "failed" {
		t.Fatalf("unexpected github queue failure metadata: %+v", metadata)
	}
	if metadata["error"] != "enqueue deployment: redis down" || metadata["commit_sha"] != "abc1234" {
		t.Fatalf("expected failure details to be preserved, got %+v", metadata)
	}
}

func TestGitHubIgnoredPushMetadataIncludesDecisionEvidence(t *testing.T) {
	metadata := githubIgnoredPushMetadata(githubhook.Push{
		Branch:    "main",
		CommitSHA: "0000000000000000000000000000000000000000",
		Actor:     "ali",
	}, "branch_deleted")

	if metadata["reason"] != "branch_deleted" || metadata["branch"] != "main" {
		t.Fatalf("expected ignored push decision metadata, got %+v", metadata)
	}
	if metadata["commit_sha"] != "0000000000000000000000000000000000000000" || metadata["actor"] != "ali" {
		t.Fatalf("expected ignored push actor and commit metadata, got %+v", metadata)
	}
}

func TestGitHubPushBranchUsesDeploymentRefValidation(t *testing.T) {
	for _, branch := range []string{"main", "release/2026-06", "feature_api.v2"} {
		t.Run(branch, func(t *testing.T) {
			if err := validateGitHubPushBranch(branch); err != nil {
				t.Fatal(err)
			}
		})
	}

	for _, branch := range []string{"-main", "feature//api", "feature..api", "feature/api.lock", "feature api", "feature@{1}"} {
		t.Run(branch, func(t *testing.T) {
			if err := validateGitHubPushBranch(branch); err == nil {
				t.Fatal("expected unsafe branch to fail")
			}
		})
	}
}

func TestNormalizeGitHubEventTrimsAndLowercases(t *testing.T) {
	event, err := normalizeGitHubEvent(" Push ")
	if err != nil {
		t.Fatal(err)
	}
	if event != "push" {
		t.Fatalf("expected normalized push event, got %q", event)
	}
}

func TestNormalizeGitHubEventRequiresCleanHeader(t *testing.T) {
	for _, value := range []string{"", " ", "push\nping", "push\t"} {
		t.Run(value, func(t *testing.T) {
			if _, err := normalizeGitHubEvent(value); err == nil {
				t.Fatal("expected malformed github event header to fail")
			}
		})
	}
}
