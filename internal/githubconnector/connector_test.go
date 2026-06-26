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
