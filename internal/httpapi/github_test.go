package httpapi

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"deploy-manager/internal/db"
	"deploy-manager/internal/githubconnector"
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

func TestGitHubStatusReportsMissingRuntimeConfig(t *testing.T) {
	handler := New(nil, nil, nil, nil, nil, GitHubWebhookConfig{}, nil, "", AuthConfig{Disabled: true})
	request := httptest.NewRequest(http.MethodGet, "/api/github/status", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", response.Code)
	}
	body := response.Body.String()
	if !strings.Contains(body, `"app_configured":false`) || !strings.Contains(body, `"build_dispatch_enabled":false`) {
		t.Fatalf("expected missing github app status, got %s", body)
	}
	if strings.Contains(body, "GITHUB_WEBHOOK_SECRET") {
		t.Fatalf("webhook secret should not be required for basic github setup, got %s", body)
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

func TestGitHubPushBuildRequestUsesRepositoryBuildMetadata(t *testing.T) {
	request := githubPushBuildRequest(githubconnector.Repository{
		Repository:   "prosights/recreate",
		Branch:       "main",
		WorkflowID:   "deploy-manager-build.yml",
		BuildContext: "apps/web",
		Dockerfile:   "apps/web/Dockerfile",
		ImageRef:     "us-docker.pkg.dev/prosights/recreate/web:main",
		Runner:       "linux_32_core",
	}, githubhook.Push{CommitSHA: "0123456789abcdef0123456789abcdef01234567"})

	if request.WorkflowID != "deploy-manager-build.yml" {
		t.Fatalf("expected workflow id from repository metadata, got %+v", request)
	}
	if request.Inputs["image_ref"] != "us-docker.pkg.dev/prosights/recreate/web:main" || request.Inputs["runner"] != "linux_32_core" {
		t.Fatalf("expected build target metadata in workflow inputs, got %+v", request.Inputs)
	}
	if request.Inputs["build_context"] != "apps/web" || request.Inputs["dockerfile"] != "apps/web/Dockerfile" {
		t.Fatalf("expected build path metadata in workflow inputs, got %+v", request.Inputs)
	}
	if request.Inputs["commit_sha"] != "0123456789abcdef0123456789abcdef01234567" {
		t.Fatalf("expected commit sha in workflow inputs, got %+v", request.Inputs)
	}
	if err := validateGitHubBuildDispatchRequest(request); err != nil {
		t.Fatal(err)
	}
}

func TestRepositoryTargetsApplication(t *testing.T) {
	appID := pgtype.UUID{Bytes: [16]byte{0x37, 0x78, 0x93, 0x21, 0x6d, 0xd4, 0x45, 0x11, 0x8f, 0x5f, 0x4f, 0xfe, 0xbc, 0x6d, 0x97, 0x35}, Valid: true}

	if !repositoryTargetsApplication(githubconnector.Repository{ApplicationID: "37789321-6dd4-4511-8f5f-4ffebc6d9735"}, appID, "finops") {
		t.Fatal("expected application_id target to match")
	}
	if !repositoryTargetsApplication(githubconnector.Repository{ApplicationName: "FinOps"}, pgtype.UUID{}, "finops") {
		t.Fatal("expected application_name target to match case-insensitively")
	}
	if repositoryTargetsApplication(githubconnector.Repository{ApplicationName: "portal"}, pgtype.UUID{}, "finops") {
		t.Fatal("expected different application name to miss")
	}
}

func TestRepositoryMatchesChangedPaths(t *testing.T) {
	repository := githubconnector.Repository{PathFilters: []string{"finops/**", "packages/shared"}}

	if !repositoryMatchesChangedPaths(repository, []string{"finops/api/main.go"}) {
		t.Fatal("expected finops path to match")
	}
	if !repositoryMatchesChangedPaths(repository, []string{"packages/shared/logger.go"}) {
		t.Fatal("expected shared package path to match")
	}
	if repositoryMatchesChangedPaths(repository, []string{"portal/Dockerfile"}) {
		t.Fatal("expected unrelated path to miss")
	}
	if repositoryMatchesChangedPaths(repository, nil) {
		t.Fatal("expected path-scoped target to miss when changed paths are unavailable")
	}
}

func TestGitHubConnectorBuildTargetScopesAccessOnlyRepositoryToApplicationPath(t *testing.T) {
	config := []byte(`{"installation_id":"123456","repositories":[{"repository":"prosights/internal","branch":"main"}]}`)
	application := db.ListApplicationsForGitHubPushRow{Name: "finops", ComposePath: "finops/docker-compose.yml"}

	repository, owned, err := githubConnectorBuildTarget(config, "prosights/internal", "main", application, []string{"finops/api/main.go"})
	if err != nil || !owned || repository.Repository != "prosights/internal" {
		t.Fatalf("expected matching app source target, got %+v, owned=%v, err=%v", repository, owned, err)
	}
	repository, owned, err = githubConnectorBuildTarget(config, "prosights/internal", "main", application, []string{"portal/src/main.tsx"})
	if err != nil || !owned || repository.Repository != "" {
		t.Fatalf("expected unrelated app path to be skipped, got %+v, owned=%v, err=%v", repository, owned, err)
	}
}

func TestGitHubConnectorBuildTargetPrefersApplicationSpecificTarget(t *testing.T) {
	config := []byte(`{"installation_id":"123456","repositories":[{"repository":"prosights/internal","branch":"main","image_ref":"registry.example.com/generic:main"},{"application_id":"37789321-6dd4-4511-8f5f-4ffebc6d9735","repository":"prosights/internal","branch":"main","image_ref":"registry.example.com/finops:main","path_filters":["finops/**"]}]}`)
	application := db.ListApplicationsForGitHubPushRow{
		ID:          pgtype.UUID{Bytes: [16]byte{0x37, 0x78, 0x93, 0x21, 0x6d, 0xd4, 0x45, 0x11, 0x8f, 0x5f, 0x4f, 0xfe, 0xbc, 0x6d, 0x97, 0x35}, Valid: true},
		Name:        "finops",
		ComposePath: "finops/docker-compose.yml",
	}

	repository, owned, err := githubConnectorBuildTarget(config, "prosights/internal", "main", application, []string{"finops/api/main.go"})
	if err != nil || !owned || repository.ImageRef != "registry.example.com/finops:main" {
		t.Fatalf("expected application-specific build target, got %+v, owned=%v, err=%v", repository, owned, err)
	}
}
