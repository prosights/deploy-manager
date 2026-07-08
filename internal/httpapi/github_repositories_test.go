package httpapi

import (
	"testing"

	"deploy-manager/internal/db"
	"deploy-manager/internal/githubconnector"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestGitHubConfigFromInstallationRepositories(t *testing.T) {
	config, err := githubConfigFromInstallationRepositories("123456", []githubconnector.AppRepository{{
		ID:            42,
		FullName:      "prosights/recreate",
		DefaultBranch: "dev",
	}, {
		ID:       43,
		FullName: "prosights/api",
	}})
	if err != nil {
		t.Fatal(err)
	}

	repositories, err := githubconnector.RepositoriesFromConfig(config)
	if err != nil {
		t.Fatal(err)
	}
	if len(repositories) != 2 {
		t.Fatalf("expected two repositories, got %+v", repositories)
	}
	if repositories[0].InstallationID != "123456" || repositories[0].RepositoryID != "42" || repositories[0].Branch != "dev" {
		t.Fatalf("unexpected first repository: %+v", repositories[0])
	}
	if repositories[1].Branch != "main" {
		t.Fatalf("expected missing default branch to fall back to main, got %+v", repositories[1])
	}
}

func TestGitHubConfigFromInstallationRepositoriesPreservesBuildMetadata(t *testing.T) {
	config, err := githubConfigFromInstallationRepositoriesWithDefaults("123456", []githubconnector.AppRepository{{
		ID:            42,
		FullName:      "prosights/recreate",
		DefaultBranch: "main",
	}}, []githubconnector.Repository{{
		Repository:   "prosights/recreate",
		Branch:       "main",
		WorkflowID:   "deploy-manager-build.yml",
		BuildContext: "apps/web",
		Dockerfile:   "apps/web/Dockerfile",
		ImageRef:     "us-docker.pkg.dev/prosights/recreate/web:main",
		Runner:       "linux_32_core",
	}})
	if err != nil {
		t.Fatal(err)
	}
	repositories, err := githubconnector.RepositoriesFromConfig(config)
	if err != nil {
		t.Fatal(err)
	}
	repository := repositories[0]
	if repository.ImageRef != "us-docker.pkg.dev/prosights/recreate/web:main" || repository.Runner != "linux_32_core" {
		t.Fatalf("expected build metadata to survive sync, got %+v", repository)
	}
	if repository.BuildContext != "apps/web" || repository.Dockerfile != "apps/web/Dockerfile" {
		t.Fatalf("expected build path metadata to survive sync, got %+v", repository)
	}
}

func TestGitHubConfigFromInstallationRepositoriesRejectsEmptyResult(t *testing.T) {
	_, err := githubConfigFromInstallationRepositories("123456", []githubconnector.AppRepository{{ID: 42}})
	if err == nil {
		t.Fatal("expected empty repository sync result to fail")
	}
}

func TestNormalizeGitHubBuildDispatchRequestDefaultsWorkflowAndBranch(t *testing.T) {
	request := normalizeGitHubBuildDispatchRequest(githubBuildDispatchRequest{
		Repository: " prosights/recreate ",
	})
	if request.Repository != "prosights/recreate" || request.Branch != "main" || request.WorkflowID != "" {
		t.Fatalf("unexpected normalized request: %+v", request)
	}
}

func TestGitHubConnectorRepositoryRequiresConnectedRepository(t *testing.T) {
	config := []byte(`{
		"installation_id": "123456",
		"repositories": [{"repository":"prosights/recreate","branch":"main"}]
	}`)
	repository, err := githubConnectorRepository(config, "prosights/recreate", "main")
	if err != nil {
		t.Fatal(err)
	}
	if repository.InstallationID != "123456" {
		t.Fatalf("expected installation id from config, got %+v", repository)
	}
	if _, err := githubConnectorRepository(config, "prosights/other", "main"); err == nil {
		t.Fatal("expected unconnected repository to fail")
	}
}

func TestGitHubConnectorRepositoryAllowsBranchOverride(t *testing.T) {
	config := []byte(`{
		"installation_id": "123456",
		"repositories": [{"repository":"prosights/recreate","branch":"main"}]
	}`)
	repository, err := githubConnectorRepository(config, "prosights/recreate", "release/2026-07")
	if err != nil {
		t.Fatal(err)
	}
	if repository.Branch != "release/2026-07" || repository.InstallationID != "123456" {
		t.Fatalf("expected connected repository with overridden branch, got %+v", repository)
	}
}

func TestGitHubConnectorRepositoryAnyBranchMatchesByName(t *testing.T) {
	config := []byte(`{
		"installation_id": "123456",
		"repositories": [{"repository":"prosights/recreate","branch":"main"}]
	}`)
	repository, err := githubConnectorRepositoryAnyBranch(config, "PROSIGHTS/RECREATE")
	if err != nil {
		t.Fatal(err)
	}
	if repository.Repository != "prosights/recreate" || repository.Branch != "main" {
		t.Fatalf("expected case-insensitive repository match, got %+v", repository)
	}
	if _, err := githubConnectorRepositoryAnyBranch(config, "prosights/other"); err == nil {
		t.Fatal("expected unconnected repository to fail")
	}
}

func TestGitHubBuildWorkflowInputsIncludesCallbackIdentity(t *testing.T) {
	buildID := pgtype.UUID{Bytes: [16]byte{1, 2, 3}, Valid: true}
	inputs := githubBuildWorkflowInputs(map[string]string{"custom": "value", "branch": "override"}, db.BuildRun{
		ID:         buildID,
		Repository: "prosights/recreate",
		Branch:     "main",
	})
	if inputs["deploy_manager_build_id"] != "01020300-0000-0000-0000-000000000000" {
		t.Fatalf("expected build id input, got %+v", inputs)
	}
	if inputs["repository"] != "prosights/recreate" || inputs["branch"] != "main" || inputs["custom"] != "value" {
		t.Fatalf("unexpected workflow inputs: %+v", inputs)
	}
}

func TestFillGitHubBuildDefaultsUsesRepositoryBuildMetadata(t *testing.T) {
	request := fillGitHubBuildDefaults(githubBuildDispatchRequest{}, githubconnector.Repository{
		WorkflowID:   "custom-build.yml",
		BuildContext: "apps/api",
		Dockerfile:   "apps/api/Dockerfile",
		ImageRef:     "us-docker.pkg.dev/prosights/recreate/api:main",
		Runner:       "linux_32_core",
	})
	if request.WorkflowID != "custom-build.yml" {
		t.Fatalf("expected repository workflow id, got %+v", request)
	}
	if request.Inputs["build_context"] != "apps/api" || request.Inputs["dockerfile"] != "apps/api/Dockerfile" {
		t.Fatalf("expected build path inputs, got %+v", request.Inputs)
	}
	if request.Inputs["image_ref"] != "us-docker.pkg.dev/prosights/recreate/api:main" || request.Inputs["runner"] != "linux_32_core" {
		t.Fatalf("expected build target inputs, got %+v", request.Inputs)
	}
}

func TestValidateGitHubBuildDispatchRequestRequiresImageRef(t *testing.T) {
	err := validateGitHubBuildDispatchRequest(githubBuildDispatchRequest{
		Repository: "prosights/recreate",
		Branch:     "main",
		WorkflowID: "deploy-manager-build.yml",
		Inputs:     map[string]string{},
	})
	if err == nil {
		t.Fatal("expected missing image_ref to fail")
	}
}
