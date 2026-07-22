package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
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

func TestGitHubConfigFromInstallationRepositoriesPreservesEveryApplicationTarget(t *testing.T) {
	const portalID = "11111111-1111-4111-8111-111111111111"
	const finopsID = "22222222-2222-4222-8222-222222222222"
	config, err := githubConfigFromInstallationRepositoriesWithDefaults("123456", []githubconnector.AppRepository{{
		ID:            42,
		FullName:      "prosights/internal",
		DefaultBranch: "main",
	}}, []githubconnector.Repository{{
		Repository:    "prosights/internal",
		Branch:        "main",
		ApplicationID: portalID,
		ImageRef:      "registry.example.com/portal:${SHORT_SHA}",
	}, {
		Repository:    "prosights/internal",
		Branch:        "main",
		ApplicationID: finopsID,
		ImageRef:      "registry.example.com/finops:${SHORT_SHA}",
	}})
	if err != nil {
		t.Fatal(err)
	}
	repositories, err := githubconnector.RepositoriesFromConfig(config)
	if err != nil {
		t.Fatal(err)
	}
	if len(repositories) != 2 || repositories[0].ApplicationID != portalID || repositories[1].ApplicationID != finopsID {
		t.Fatalf("expected both application targets to survive sync, got %+v", repositories)
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

func TestResolveGitHubBuildCommitExpandsBranchHeadImage(t *testing.T) {
	ref := ""
	inputs := map[string]string{"image_ref": "registry.example.com/portal:${SHORT_SHA}"}
	source := fakeGitHubRepositorySource{
		commit:    githubconnector.RepositoryCommit{SHA: "d9677d5e2e90216857f93538def483a786dee18e"},
		commitRef: &ref,
	}
	repository := githubconnector.Repository{
		InstallationID: "123456",
		Repository:     "prosights/internal",
		Branch:         "main",
	}
	if err := resolveGitHubBuildCommit(context.Background(), source, repository, inputs); err != nil {
		t.Fatal(err)
	}
	expandGitHubBuildInputTemplates(inputs, inputs["commit_sha"])
	if ref != "main" || inputs["commit_sha"] != source.commit.SHA || inputs["image_ref"] != "registry.example.com/portal:d9677d5e2e90" {
		t.Fatalf("unexpected resolved build inputs: ref=%q inputs=%+v", ref, inputs)
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

func TestFillGitHubBuildDefaultsOmitsSingleImageInputsForBuildMatrix(t *testing.T) {
	request := fillGitHubBuildDefaults(githubBuildDispatchRequest{}, githubconnector.Repository{
		BuildContext: ".",
		Dockerfile:   "Dockerfile",
		BuildMatrix:  `[{"name":"api"}]`,
		ImageRef:     "us-docker.pkg.dev/prosights/internal/api:main",
	})

	if request.Inputs["build_matrix"] == "" {
		t.Fatalf("expected build matrix input, got %+v", request.Inputs)
	}
	if _, ok := request.Inputs["build_context"]; ok {
		t.Fatalf("did not expect build_context for matrix build, got %+v", request.Inputs)
	}
	if _, ok := request.Inputs["dockerfile"]; ok {
		t.Fatalf("did not expect dockerfile for matrix build, got %+v", request.Inputs)
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

func TestRepositoryServiceName(t *testing.T) {
	if got := repositoryServiceName("prosights/recreate"); got != "recreate" {
		t.Fatalf("expected repository name, got %q", got)
	}
	if got := repositoryServiceName("  "); got != "service" {
		t.Fatalf("expected fallback service name, got %q", got)
	}
}

func TestNormalizeRepositoryRoot(t *testing.T) {
	root, err := normalizeRepositoryRoot(" ./alleyes-v2/ ")
	if err != nil || root != "alleyes-v2" {
		t.Fatalf("expected normalized root, got %q, %v", root, err)
	}
	for _, value := range []string{"/alleyes-v2", "../alleyes-v2", "alleyes-v2\\api"} {
		if _, err := normalizeRepositoryRoot(value); err == nil {
			t.Fatalf("expected root %q to fail", value)
		}
	}
}

func TestGitHubRepositoryComposeRejectsUnsafePath(t *testing.T) {
	handler := New(nil, nil, nil, nil, nil, GitHubWebhookConfig{App: fakeGitHubRepositorySource{}}, nil, t.TempDir(), AuthConfig{Disabled: true})
	request := httptest.NewRequest(http.MethodGet, "/api/github/repositories/compose?connector_id=11111111-1111-4111-8111-111111111111&repository=prosights/internal&branch=main&path=../secrets.yml", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected unsafe compose path to be rejected, got %d", response.Code)
	}
}

func TestDetectRepositoryServicesFindsInternalStyleApplications(t *testing.T) {
	source := fakeGitHubRepositorySource{contents: map[string][]githubconnector.RepositoryContent{
		"": {
			{Name: "alleyes-v2", Path: "alleyes-v2", Type: "dir"},
			{Name: "evals", Path: "evals", Type: "dir"},
		},
		"alleyes-v2": {
			{Name: "compose.coolify.yml", Path: "alleyes-v2/compose.coolify.yml", Type: "file"},
			{Name: "apps", Path: "alleyes-v2/apps", Type: "dir"},
		},
		"evals": {
			{Name: "docker-compose.yml", Path: "evals/docker-compose.yml", Type: "file"},
			{Name: "apps", Path: "evals/apps", Type: "dir"},
		},
	}, files: map[string][]byte{
		"alleyes-v2/compose.coolify.yml": []byte(`services:
  api:
    image: alleyes-api:latest
    ports:
      - target: 8000
        published: 8200
    depends_on:
      postgres:
        condition: service_healthy
  web:
    build:
      context: ./apps/web
      dockerfile: Dockerfile.web
    ports:
      - "${DEPLOY_PORT:-3201}:3000"
    depends_on: [api]
  worker:
    image: alleyes-worker:latest
    expose:
      - "9000"
`),
		"evals/docker-compose.yml": []byte(`services:
  api:
    ports:
      - "8008:8008"
  web:
    ports:
      - "3008:3008"
    depends_on: [api]
`),
	}}
	server := Server{github: GitHubWebhookConfig{App: source}}
	request, err := http.NewRequest(http.MethodGet, "/", nil)
	if err != nil {
		t.Fatal(err)
	}
	services, err := server.detectRepositoryServices(request, githubconnector.Repository{Repository: "prosights/internal", Branch: "main"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(services) != 2 {
		t.Fatalf("expected alleyes-v2 and evals, got %+v", services)
	}
	if services[0].Name != "alleyes-v2" || services[0].ComposePath != "alleyes-v2/compose.coolify.yml" {
		t.Fatalf("unexpected alleyes-v2 detection: %+v", services[0])
	}
	if services[1].Name != "evals" || services[1].ComposePath != "evals/docker-compose.yml" {
		t.Fatalf("unexpected evals detection: %+v", services[1])
	}
	if len(services[0].ComposeServices) != 3 {
		t.Fatalf("expected compose stack preview, got %+v", services[0].ComposeServices)
	}
	api, web, worker := services[0].ComposeServices[0], services[0].ComposeServices[1], services[0].ComposeServices[2]
	if api.Name != "api" || api.Image != "alleyes-api:latest" || len(api.Ports) != 1 || api.Ports[0].ContainerPort != 8000 || api.Ports[0].PublishedPort != 8200 || len(api.DependsOn) != 1 || api.DependsOn[0] != "postgres" {
		t.Fatalf("unexpected api compose metadata: %+v", api)
	}
	if web.Name != "web" || web.BuildContext != "./apps/web" || web.Dockerfile != "Dockerfile.web" || len(web.Ports) != 1 || web.Ports[0].ContainerPort != 3000 || web.Ports[0].PublishedPort != 3201 || web.Ports[0].Variable != "DEPLOY_PORT" || len(web.DependsOn) != 1 || web.DependsOn[0] != "api" {
		t.Fatalf("unexpected web compose metadata: %+v", web)
	}
	if worker.Name != "worker" || len(worker.Ports) != 1 || worker.Ports[0].ContainerPort != 9000 {
		t.Fatalf("unexpected worker expose metadata: %+v", worker)
	}

	services, err = server.detectRepositoryServices(request, githubconnector.Repository{Repository: "prosights/internal", Branch: "main"}, "alleyes-v2")
	if err != nil {
		t.Fatal(err)
	}
	if len(services) != 1 || services[0].Name != "alleyes-v2" || services[0].Root != "alleyes-v2" {
		t.Fatalf("expected root-scoped detection, got %+v", services)
	}
}

type fakeGitHubRepositorySource struct {
	contents  map[string][]githubconnector.RepositoryContent
	files     map[string][]byte
	commit    githubconnector.RepositoryCommit
	commitRef *string
}

func (f fakeGitHubRepositorySource) ListInstallationRepositories(context.Context, string) ([]githubconnector.AppRepository, error) {
	return nil, nil
}

func (f fakeGitHubRepositorySource) ListRepositoryContents(_ context.Context, _ string, _ string, directory string, _ string) ([]githubconnector.RepositoryContent, error) {
	return f.contents[directory], nil
}

func (f fakeGitHubRepositorySource) GetRepositoryFile(_ context.Context, _ string, _ string, filePath string, _ string) ([]byte, error) {
	return f.files[filePath], nil
}

func (f fakeGitHubRepositorySource) ListRepositoryBranches(context.Context, string, string) ([]string, error) {
	return nil, nil
}

func (f fakeGitHubRepositorySource) GetRepositoryCommit(_ context.Context, _, _, ref string) (githubconnector.RepositoryCommit, error) {
	if f.commitRef != nil {
		*f.commitRef = ref
	}
	return f.commit, nil
}

func (f fakeGitHubRepositorySource) DispatchWorkflow(context.Context, string, string, string, string, map[string]string) error {
	return nil
}
