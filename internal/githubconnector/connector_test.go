package githubconnector

import (
	"context"
	"testing"

	"deploy-manager/internal/connectors"
)

func TestSyncCredentialsReportsRepositoryAccess(t *testing.T) {
	inventory, err := New().SyncCredentials(context.Background(), connectors.SyncScope{
		Name: "production github",
		Config: []byte(`{
			"repositories": [{
				"repository": "prosights/api",
				"credential_name": "GitHub deploy key",
				"external_ref": "repo:prosights/api#deploy-key",
				"credential_type": "deploy_key",
				"permissions": ["contents:read"],
				"usages": [{
					"used_by_type": "application",
					"used_by_name": "api",
					"usage_context": "clone repository during deployment"
				}]
			}]
		}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(inventory) != 1 {
		t.Fatalf("expected one credential inventory item, got %+v", inventory)
	}

	item := inventory[0]
	if item.Provider != "github" || item.ExternalRef != "repo:prosights/api#deploy-key" || item.Type != "deploy_key" {
		t.Fatalf("unexpected inventory identity: %+v", item)
	}
	if len(item.Permissions) != 1 || item.Permissions[0].ResourceName != "prosights/api" || item.Permissions[0].Permission != "contents:read" {
		t.Fatalf("unexpected permissions: %+v", item.Permissions)
	}
	if len(item.Usages) != 1 || item.Usages[0].UsedByName != "api" {
		t.Fatalf("unexpected usages: %+v", item.Usages)
	}
}

func TestRepositoriesFromConfigDefaultsGitHubAppMetadata(t *testing.T) {
	repositories, err := RepositoriesFromConfig([]byte(`{
		"installation_id": "123456",
		"repositories": [
			{"repository": "prosights/api"},
			{"repository": "prosights/api", "branch": "main"},
			{"repository": "prosights/web", "branch": "release/2026-07"}
		]
	}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(repositories) != 2 {
		t.Fatalf("expected duplicate repository/branch pairs to collapse, got %+v", repositories)
	}
	first := repositories[0]
	if first.Branch != "main" || first.InstallationID != "123456" || first.CredentialType != "github_app_installation" || first.ExternalRef != "github-app:123456:prosights/api" {
		t.Fatalf("unexpected github app defaults: %+v", first)
	}
	if first.WorkflowID != DefaultBuildWorkflowID || first.BuildContext != "." || first.Dockerfile != "Dockerfile" {
		t.Fatalf("unexpected github build defaults: %+v", first)
	}
	if repositories[1].Branch != "release/2026-07" {
		t.Fatalf("unexpected branch: %+v", repositories[1])
	}
}

func TestRepositoriesFromConfigKeepsBuildMetadata(t *testing.T) {
	repositories, err := RepositoriesFromConfig([]byte(`{
		"installation_id": "123456",
		"repositories": [{
			"repository": "prosights/api",
			"branch": "main",
			"application_id": "11111111-1111-1111-1111-111111111111",
			"application_name": "api",
			"workflow_id": "custom-build.yml",
			"build_context": "apps/api",
			"dockerfile": "apps/api/Dockerfile",
			"image_ref": "us-docker.pkg.dev/prosights/recreate/api:main",
			"build_matrix": "[{\"image_ref\":\"us-docker.pkg.dev/prosights/recreate/api:main\",\"build_context\":\"apps/api\",\"dockerfile\":\"apps/api/Dockerfile\"}]",
			"runner": "linux_32_core",
			"path_filters": ["apps/api/**", "apps/api/**", "packages/shared"]
		}]
	}`))
	if err != nil {
		t.Fatal(err)
	}
	repository := repositories[0]
	if repository.ApplicationID != "11111111-1111-1111-1111-111111111111" || repository.ApplicationName != "api" {
		t.Fatalf("unexpected application target metadata: %+v", repository)
	}
	if repository.WorkflowID != "custom-build.yml" || repository.BuildContext != "apps/api" || repository.Dockerfile != "apps/api/Dockerfile" {
		t.Fatalf("unexpected build path metadata: %+v", repository)
	}
	if repository.ImageRef != "us-docker.pkg.dev/prosights/recreate/api:main" || repository.Runner != "linux_32_core" {
		t.Fatalf("unexpected build target metadata: %+v", repository)
	}
	if repository.BuildMatrix == "" {
		t.Fatalf("expected build matrix metadata: %+v", repository)
	}
	if len(repository.PathFilters) != 2 || repository.PathFilters[0] != "apps/api/**" || repository.PathFilters[1] != "packages/shared" {
		t.Fatalf("unexpected path filters: %+v", repository.PathFilters)
	}
}

func TestRepositoriesFromConfigKeepsMonorepoApplicationTargets(t *testing.T) {
	repositories, err := RepositoriesFromConfig([]byte(`{
		"installation_id": "123456",
		"repositories": [
			{
				"repository": "prosights/internal",
				"branch": "main",
				"application_name": "portal",
				"path_filters": ["portal/**"]
			},
			{
				"repository": "prosights/internal",
				"branch": "main",
				"application_name": "finops",
				"path_filters": ["finops/**"]
			}
		]
	}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(repositories) != 2 {
		t.Fatalf("expected separate monorepo build targets, got %+v", repositories)
	}
	if repositories[0].ApplicationName != "portal" || repositories[1].ApplicationName != "finops" {
		t.Fatalf("unexpected monorepo targets: %+v", repositories)
	}
}

func TestRepositoriesFromConfigRejectsInvalidInstallationID(t *testing.T) {
	_, err := RepositoriesFromConfig([]byte(`{
		"installation_id": "abc",
		"repositories": [{"repository": "prosights/api"}]
	}`))
	if err == nil {
		t.Fatal("expected invalid installation_id to fail")
	}
}

func TestSyncCredentialsDefaultsRepositoryUsage(t *testing.T) {
	inventory, err := New().SyncCredentials(context.Background(), connectors.SyncScope{
		Config: []byte(`{
			"repositories": [{
				"repository": "prosights/api",
				"credential_name": "GitHub deploy key",
				"external_ref": "repo:prosights/api#deploy-key"
			}]
		}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(inventory[0].Usages) != 1 || inventory[0].Usages[0].UsedByType != "repository" {
		t.Fatalf("expected default repository usage, got %+v", inventory[0].Usages)
	}
}

func TestSyncCredentialsRejectsInvalidStatus(t *testing.T) {
	_, err := New().SyncCredentials(context.Background(), connectors.SyncScope{
		Config: []byte(`{
			"repositories": [{
				"repository": "prosights/api",
				"credential_name": "GitHub deploy key",
				"external_ref": "repo:prosights/api#deploy-key",
				"status": "disabled"
			}]
		}`),
	})
	if err == nil {
		t.Fatal("expected invalid status to fail")
	}
}

func TestSyncCredentialsRejectsEmptyRepositoryConfig(t *testing.T) {
	_, err := New().SyncCredentials(context.Background(), connectors.SyncScope{
		Name:   "github",
		Config: []byte(`{"repositories":[]}`),
	})
	if err == nil {
		t.Fatal("expected empty repository config to fail")
	}
}

func TestSyncCredentialsRejectsInvalidRepository(t *testing.T) {
	_, err := New().SyncCredentials(context.Background(), connectors.SyncScope{
		Config: []byte(`{
			"repositories": [{
				"repository": "https://github.com/prosights/api",
				"credential_name": "GitHub deploy key",
				"external_ref": "repo:prosights/api#deploy-key"
			}]
		}`),
	})
	if err == nil {
		t.Fatal("expected invalid repository to fail")
	}
}
