package objectstorage

import (
	"context"
	"testing"

	"deploy-manager/internal/connectors"
)

func TestToCredentialInventoryMapsBucketAccess(t *testing.T) {
	inventory, err := ToCredentialInventory(BucketInventory{
		Provider:       "s3",
		CredentialName: "prod-deploy",
		ExternalRef:    "arn:aws:iam::123:role/prod-deploy",
		Bucket:         "assets-prod",
		Permissions:    []string{"s3:GetObject", "s3:PutObject"},
		Usages: []Usage{{
			UsedByType:   "application",
			UsedByName:   "api",
			UsageContext: "object uploads",
		}},
	})
	if err != nil {
		t.Fatal(err)
	}

	if inventory.Provider != "s3" || inventory.Type != "service_account" {
		t.Fatalf("unexpected inventory: %+v", inventory)
	}
	if inventory.Permissions[0].ResourceName != "s3://assets-prod" {
		t.Fatalf("unexpected resource name: %+v", inventory.Permissions[0])
	}
	if inventory.Usages[0].UsageContext != "object uploads" {
		t.Fatalf("unexpected usages: %+v", inventory.Usages)
	}
}

func TestToCredentialInventoryRejectsUnsupportedProvider(t *testing.T) {
	_, err := ToCredentialInventory(BucketInventory{
		Provider:       "azure",
		CredentialName: "deploy",
		ExternalRef:    "ref",
		Bucket:         "bucket",
	})
	if err == nil {
		t.Fatal("expected unsupported provider to fail")
	}
}

func TestToCredentialInventoryNormalizesStatus(t *testing.T) {
	inventory, err := ToCredentialInventory(BucketInventory{
		Provider:       "gcs",
		CredentialName: "deploy",
		ExternalRef:    "service-account@example.iam.gserviceaccount.com",
		Status:         " rotating ",
		Bucket:         "assets",
	})
	if err != nil {
		t.Fatal(err)
	}

	if inventory.Status != "rotating" {
		t.Fatalf("expected normalized status, got %q", inventory.Status)
	}
}

func TestToCredentialInventoryRejectsInvalidStatus(t *testing.T) {
	_, err := ToCredentialInventory(BucketInventory{
		Provider:       "s3",
		CredentialName: "deploy",
		ExternalRef:    "arn:aws:iam::123:role/deploy",
		Status:         "disabled",
		Bucket:         "assets-prod",
	})
	if err == nil {
		t.Fatal("expected invalid status to fail")
	}
}

func TestToCredentialInventoryMapsGCSBucketResource(t *testing.T) {
	inventory, err := ToCredentialInventory(BucketInventory{
		Provider:       " GCS ",
		CredentialName: "deploy",
		ExternalRef:    "service-account@example.iam.gserviceaccount.com",
		Bucket:         "assets-prod",
		Permissions:    []string{"storage.objects.get"},
	})
	if err != nil {
		t.Fatal(err)
	}

	if inventory.Provider != "gcs" {
		t.Fatalf("expected normalized provider, got %q", inventory.Provider)
	}
	if inventory.Permissions[0].ResourceName != "gs://assets-prod" {
		t.Fatalf("unexpected resource name: %+v", inventory.Permissions[0])
	}
	if inventory.Permissions[0].Source != "gcs" {
		t.Fatalf("expected permission source to remain gcs, got %+v", inventory.Permissions[0])
	}
}

func TestToCredentialInventoryDefaultsBucketUsage(t *testing.T) {
	inventory, err := ToCredentialInventory(BucketInventory{
		Provider:       "s3",
		CredentialName: "assets role",
		ExternalRef:    "arn:aws:iam::123:role/assets",
		Bucket:         "assets-prod",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(inventory.Usages) != 1 {
		t.Fatalf("expected default bucket usage, got %+v", inventory.Usages)
	}
	usage := inventory.Usages[0]
	if usage.UsedByType != "bucket" || usage.UsedByName != "s3://assets-prod" || usage.UsageContext != "object storage access" {
		t.Fatalf("unexpected default bucket usage: %+v", usage)
	}
}

func TestConnectorSyncCredentialsFromMetadataBuckets(t *testing.T) {
	inventory, err := NewConnector("s3").SyncCredentials(context.Background(), connectors.SyncScope{
		Name: "production buckets",
		Config: []byte(`{
			"buckets": [{
				"credential_name": "assets role",
				"external_ref": "arn:aws:iam::123:role/assets",
				"bucket": "assets-prod",
				"permissions": ["s3:GetObject"],
				"usages": [{
					"used_by_type": "application",
					"used_by_name": "api",
					"usage_context": "read uploads"
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
	if inventory[0].Provider != "s3" || inventory[0].Permissions[0].ResourceName != "s3://assets-prod" {
		t.Fatalf("unexpected connector inventory: %+v", inventory[0])
	}
	if inventory[0].Usages[0].UsedByName != "api" {
		t.Fatalf("unexpected connector usage: %+v", inventory[0].Usages)
	}
}

func TestConnectorSyncCredentialsDefaultsBucketUsage(t *testing.T) {
	inventory, err := NewConnector("gcs").SyncCredentials(context.Background(), connectors.SyncScope{
		Name: "gcs buckets",
		Config: []byte(`{
			"buckets": [{
				"credential_name": "assets service account",
				"external_ref": "service-account@example.iam.gserviceaccount.com",
				"bucket": "assets-prod",
				"permissions": ["storage.objects.get"]
			}]
		}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(inventory[0].Usages) != 1 || inventory[0].Usages[0].UsedByName != "gs://assets-prod" {
		t.Fatalf("expected default GCS bucket usage, got %+v", inventory[0].Usages)
	}
}

func TestConnectorSyncCredentialsAllowsMatchingExplicitProvider(t *testing.T) {
	inventory, err := NewConnector("s3").SyncCredentials(context.Background(), connectors.SyncScope{
		Name: "production buckets",
		Config: []byte(`{
			"buckets": [{
				"provider": " S3 ",
				"credential_name": "assets role",
				"external_ref": "arn:aws:iam::123:role/assets",
				"bucket": "assets-prod"
			}]
		}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if inventory[0].Provider != "s3" {
		t.Fatalf("expected s3 inventory, got %+v", inventory[0])
	}
}

func TestConnectorSyncCredentialsRejectsBucketProviderMismatch(t *testing.T) {
	_, err := NewConnector("s3").SyncCredentials(context.Background(), connectors.SyncScope{
		Name: "production buckets",
		Config: []byte(`{
			"buckets": [{
				"provider": "gcs",
				"credential_name": "assets role",
				"external_ref": "arn:aws:iam::123:role/assets",
				"bucket": "assets-prod"
			}]
		}`),
	})
	if err == nil {
		t.Fatal("expected bucket provider mismatch to fail")
	}
}

func TestConnectorSyncCredentialsRejectsEmptyBucketConfig(t *testing.T) {
	_, err := NewConnector("gcs").SyncCredentials(context.Background(), connectors.SyncScope{
		Name:   "gcs buckets",
		Config: []byte(`{"buckets":[]}`),
	})
	if err == nil {
		t.Fatal("expected empty bucket config to fail")
	}
}
