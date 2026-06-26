package httpapi

import (
	"context"
	"errors"
	"testing"

	"deploy-manager/internal/connectors"
	"deploy-manager/internal/db"
	"deploy-manager/internal/objectstorage"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestNormalizeCredentialInventoryItemNormalizesProvider(t *testing.T) {
	item, err := normalizeCredentialInventoryItem(credentialInventoryItem{
		Name:           " GitHub deploy key ",
		Provider:       " GitHub ",
		ExternalRef:    " repo:prosights/api ",
		CredentialType: " deploy_key ",
	})
	if err != nil {
		t.Fatal(err)
	}
	if item.Provider != "github" || item.Name != "GitHub deploy key" || item.ExternalRef != "repo:prosights/api" {
		t.Fatalf("unexpected normalized item: %+v", item)
	}
}

func TestNormalizeCredentialInventoryItemAllowsSSHProvider(t *testing.T) {
	item, err := normalizeCredentialInventoryItem(credentialInventoryItem{
		Name:           "Production SSH key",
		Provider:       "ssh",
		ExternalRef:    "server:prod-1",
		CredentialType: "ssh_key",
	})
	if err != nil {
		t.Fatal(err)
	}
	if item.Provider != "ssh" {
		t.Fatalf("expected ssh provider, got %+v", item)
	}
}

func TestNormalizeCredentialInventoryItemRejectsUnsupportedProvider(t *testing.T) {
	_, err := normalizeCredentialInventoryItem(credentialInventoryItem{
		Name:           "Vault token",
		Provider:       "vault",
		ExternalRef:    "secret:deploy",
		CredentialType: "token",
	})
	if err == nil {
		t.Fatal("expected unsupported provider to fail")
	}
}

func TestNormalizeCredentialInventoryItemRejectsControlCharacters(t *testing.T) {
	_, err := normalizeCredentialInventoryItem(credentialInventoryItem{
		Name:           "GitHub deploy\nkey",
		Provider:       "github",
		ExternalRef:    "repo:prosights/api",
		CredentialType: "deploy_key",
	})
	if err == nil {
		t.Fatal("expected control character in credential name to fail")
	}
}

func TestNormalizeCredentialInventoryItemRejectsSecretMaterialExternalRef(t *testing.T) {
	for _, externalRef := range []string{
		"-----BEGIN PRIVATE KEY-----",
		"ghp_1234567890abcdef",
		"xoxb-123-secret",
		`{"type":"service_account","private_key_id":"abc123","client_email":"deploy@example.iam.gserviceaccount.com"}`,
		`{"access_token":"token","refresh_token":"refresh"}`,
	} {
		t.Run(externalRef, func(t *testing.T) {
			_, err := normalizeCredentialInventoryItem(credentialInventoryItem{
				Name:           "GitHub deploy key",
				Provider:       "github",
				ExternalRef:    externalRef,
				CredentialType: "deploy_key",
			})
			if err == nil {
				t.Fatal("expected secret material external_ref to fail")
			}
		})
	}
}

func TestNormalizeCredentialInventoryItemAllowsReferenceExternalRef(t *testing.T) {
	_, err := normalizeCredentialInventoryItem(credentialInventoryItem{
		Name:           "GitHub API token",
		Provider:       "github",
		ExternalRef:    "repo:prosights/api#deploy-token",
		CredentialType: "api_token",
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestNormalizeCredentialInventoryInputValidatesFullBatchBeforeWrite(t *testing.T) {
	_, err := normalizeCredentialInventoryInput(credentialInventoryInput{
		Credentials: []credentialInventoryItem{
			{
				Name:           "GitHub deploy key",
				Provider:       "github",
				ExternalRef:    "repo:prosights/api",
				CredentialType: "deploy_key",
			},
			{
				Name:           "Vault token",
				Provider:       "vault",
				ExternalRef:    "secret:deploy",
				CredentialType: "token",
			},
		},
	})
	if err == nil {
		t.Fatal("expected invalid batch item to fail")
	}
}

func TestNormalizeCredentialInventoryInputRejectsOversizedBatch(t *testing.T) {
	input := credentialInventoryInput{
		Credentials: make([]credentialInventoryItem, maxCredentialInventoryBatchSize+1),
	}
	for index := range input.Credentials {
		input.Credentials[index] = credentialInventoryItem{
			Name:           "GitHub deploy key",
			Provider:       "github",
			ExternalRef:    "repo:prosights/api",
			CredentialType: "deploy_key",
		}
	}

	_, err := normalizeCredentialInventoryInput(input)
	if err == nil {
		t.Fatal("expected oversized credential inventory batch to fail")
	}
}

func TestNormalizeCredentialInventoryInputMergesDuplicateCredentialFacts(t *testing.T) {
	input, err := normalizeCredentialInventoryInput(credentialInventoryInput{
		Credentials: []credentialInventoryItem{
			{
				Name:           "Assets role",
				Provider:       " S3 ",
				ExternalRef:    " arn:aws:iam::123:role/assets ",
				CredentialType: "iam_role",
				Status:         "active",
				Permissions: []credentialPermissionInput{{
					ResourceType: "bucket",
					ResourceName: "s3://assets",
					Permission:   "s3:GetObject",
					Source:       "s3",
				}},
			},
			{
				Name:           "Assets role duplicate",
				Provider:       "s3",
				ExternalRef:    "arn:aws:iam::123:role/assets",
				CredentialType: "iam_role",
				Status:         "rotating",
				Permissions: []credentialPermissionInput{{
					ResourceType: "bucket",
					ResourceName: "s3://assets",
					Permission:   "s3:PutObject",
					Source:       "s3",
				}},
				Usages: []credentialUsageInput{{
					UsedByType:   "application",
					UsedByName:   "api",
					UsageContext: "uploads",
				}},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(input.Credentials) != 1 {
		t.Fatalf("expected duplicate credential records to merge, got %+v", input.Credentials)
	}
	credential := input.Credentials[0]
	if credential.Status != "rotating" {
		t.Fatalf("expected highest-risk status to be preserved, got %+v", credential)
	}
	if len(credential.Permissions) != 2 || len(credential.Usages) != 1 {
		t.Fatalf("expected merged permission and usage facts, got %+v", credential)
	}
}

func TestCredentialInventoryFromObjectStorageValidatesFullBatch(t *testing.T) {
	_, err := credentialInventoryFromObjectStorage([]objectstorage.BucketInventory{
		{
			Provider:       "s3",
			CredentialName: "assets deploy role",
			ExternalRef:    "arn:aws:iam::123:role/assets",
			Bucket:         "assets",
		},
		{
			Provider:       "unsupported",
			CredentialName: "bad",
			ExternalRef:    "bucket:bad",
			Bucket:         "bad",
		},
	})
	if err == nil {
		t.Fatal("expected invalid object storage provider to fail")
	}
}

func TestCredentialInventoryFromObjectStorageRejectsOversizedBatch(t *testing.T) {
	_, err := credentialInventoryFromObjectStorage(make([]objectstorage.BucketInventory, maxCredentialInventoryBatchSize+1))
	if err == nil {
		t.Fatal("expected oversized object storage inventory batch to fail")
	}
}

func TestCredentialInventoryFromObjectStorageMergesBucketsForSharedCredential(t *testing.T) {
	items, err := credentialInventoryFromObjectStorage([]objectstorage.BucketInventory{
		{
			Provider:       "s3",
			CredentialName: "assets role",
			ExternalRef:    "arn:aws:iam::123:role/assets",
			Bucket:         "assets-prod",
			Permissions:    []string{"s3:GetObject"},
		},
		{
			Provider:       "s3",
			CredentialName: "assets role",
			ExternalRef:    "arn:aws:iam::123:role/assets",
			Bucket:         "uploads-prod",
			Permissions:    []string{"s3:PutObject"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("expected shared credential buckets to merge, got %+v", items)
	}
	if len(items[0].Permissions) != 2 {
		t.Fatalf("expected permissions for both buckets, got %+v", items[0].Permissions)
	}
}

func TestCredentialInventoryFromConnectorNormalizesInventoryFacts(t *testing.T) {
	items, err := credentialInventoryFromConnector([]connectors.CredentialInventory{{
		Name:        " deploy key ",
		Provider:    " GitHub ",
		ExternalRef: " repo:prosights/api ",
		Type:        " deploy_key ",
		Permissions: []connectors.CredentialPermission{{
			ResourceType: " repository ",
			ResourceName: " prosights/api ",
			Permission:   " contents:read ",
			Source:       " github ",
		}},
		Usages: []connectors.CredentialUsage{{
			UsedByType:   " application ",
			UsedByName:   " api ",
			UsageContext: " clone repository ",
		}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("expected one item, got %+v", items)
	}
	item := items[0]
	if item.Name != "deploy key" || item.Provider != "github" || item.ExternalRef != "repo:prosights/api" || item.CredentialType != "deploy_key" {
		t.Fatalf("unexpected normalized connector inventory: %+v", item)
	}
	if item.Permissions[0].Source != "github" || item.Usages[0].UsedByName != "api" {
		t.Fatalf("unexpected normalized connector facts: %+v", item)
	}
}

func TestCredentialInventoryFromConnectorMergesDuplicateCredentialFacts(t *testing.T) {
	items, err := credentialInventoryFromConnector([]connectors.CredentialInventory{
		{
			Name:        "deploy key",
			Provider:    "github",
			ExternalRef: "repo:prosights/api",
			Type:        "deploy_key",
			Permissions: []connectors.CredentialPermission{{
				ResourceType: "repository",
				ResourceName: "prosights/api",
				Permission:   "contents:read",
				Source:       "github",
			}},
		},
		{
			Name:        "deploy key",
			Provider:    "github",
			ExternalRef: "repo:prosights/api",
			Type:        "deploy_key",
			Usages: []connectors.CredentialUsage{{
				UsedByType:   "application",
				UsedByName:   "api",
				UsageContext: "clone repository",
			}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("expected duplicate connector credential records to merge, got %+v", items)
	}
	if len(items[0].Permissions) != 1 || len(items[0].Usages) != 1 {
		t.Fatalf("expected merged connector facts, got %+v", items[0])
	}
}

func TestCredentialInventoryFromConnectorRejectsInvalidProvider(t *testing.T) {
	_, err := credentialInventoryFromConnector([]connectors.CredentialInventory{{
		Name:        "Vault token",
		Provider:    "vault",
		ExternalRef: "secret:deploy",
		Type:        "token",
	}})
	if err == nil {
		t.Fatal("expected unsupported connector inventory provider to fail")
	}
}

func TestCredentialInventoryFromConnectorRejectsOversizedBatch(t *testing.T) {
	_, err := credentialInventoryFromConnector(make([]connectors.CredentialInventory, maxCredentialInventoryBatchSize+1))
	if err == nil {
		t.Fatal("expected oversized connector inventory batch to fail")
	}
}

func TestNormalizeCredentialPermissionsDefaultsSource(t *testing.T) {
	permissions, err := normalizeCredentialPermissions([]credentialPermissionInput{
		{
			ResourceType: " bucket ",
			ResourceName: " s3://assets ",
			Permission:   " read ",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(permissions) != 1 {
		t.Fatalf("expected one permission, got %d", len(permissions))
	}
	permission := permissions[0]
	if permission.ResourceType != "bucket" || permission.ResourceName != "s3://assets" || permission.Permission != "read" || permission.Source != "connector" {
		t.Fatalf("unexpected normalized permission: %+v", permission)
	}
}

func TestNormalizeCredentialPermissionsRejectsIncompleteFacts(t *testing.T) {
	_, err := normalizeCredentialPermissions([]credentialPermissionInput{{ResourceType: "bucket", Permission: "read"}})
	if err == nil {
		t.Fatal("expected incomplete permission to fail")
	}
}

func TestNormalizeCredentialPermissionsRejectsControlCharacters(t *testing.T) {
	_, err := normalizeCredentialPermissions([]credentialPermissionInput{{
		ResourceType: "bucket",
		ResourceName: "s3://assets",
		Permission:   "read\nwrite",
	}})
	if err == nil {
		t.Fatal("expected control character in permission to fail")
	}
}

func TestNormalizeCredentialPermissionsDeduplicatesFacts(t *testing.T) {
	permissions, err := normalizeCredentialPermissions([]credentialPermissionInput{
		{
			ResourceType: " bucket ",
			ResourceName: " s3://assets ",
			Permission:   " read ",
			Source:       "s3",
		},
		{
			ResourceType: "bucket",
			ResourceName: "s3://assets",
			Permission:   "read",
			Source:       "connector",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(permissions) != 1 {
		t.Fatalf("expected duplicate permission to be collapsed, got %+v", permissions)
	}
	if permissions[0].Source != "s3" {
		t.Fatalf("expected first source to be kept, got %+v", permissions[0])
	}
}

func TestNormalizeCredentialUsagesRejectsIncompleteFacts(t *testing.T) {
	_, err := normalizeCredentialUsages([]credentialUsageInput{{UsedByType: "application", UsageContext: "read assets"}})
	if err == nil {
		t.Fatal("expected incomplete usage to fail")
	}
}

func TestNormalizeCredentialUsagesRejectsControlCharacters(t *testing.T) {
	_, err := normalizeCredentialUsages([]credentialUsageInput{{
		UsedByType:   "application",
		UsedByName:   "api",
		UsageContext: "read assets\nand uploads",
	}})
	if err == nil {
		t.Fatal("expected control character in usage context to fail")
	}
}

func TestNormalizeCredentialUsagesDeduplicatesFacts(t *testing.T) {
	usages, err := normalizeCredentialUsages([]credentialUsageInput{
		{
			UsedByType:   " application ",
			UsedByName:   " api ",
			UsageContext: " uploads ",
		},
		{
			UsedByType:   "application",
			UsedByName:   "api",
			UsageContext: "uploads",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(usages) != 1 {
		t.Fatalf("expected duplicate usage to be collapsed, got %+v", usages)
	}
}

func TestInventoryProviderCountsSkipBlankProviders(t *testing.T) {
	counts := inventoryProviderCounts([]string{"github", "GitHub", " ", "s3"})

	if counts["github"] != 2 || counts["s3"] != 1 {
		t.Fatalf("unexpected counts: %+v", counts)
	}
	if _, ok := counts[""]; ok {
		t.Fatal("did not expect blank provider count")
	}
}

func TestUpsertCredentialInventoryItemReplacesFactsInOrder(t *testing.T) {
	queries := &fakeCredentialInventoryQueries{}

	credential, err := upsertCredentialInventoryItem(context.Background(), queries, credentialInventoryItem{
		Name:           "GitHub deploy key",
		Provider:       "github",
		ExternalRef:    "repo:prosights/api",
		CredentialType: "deploy_key",
		Status:         "active",
		Permissions: []credentialPermissionInput{{
			ResourceType: "repository",
			ResourceName: "prosights/api",
			Permission:   "contents:read",
			Source:       "github",
		}},
		Usages: []credentialUsageInput{{
			UsedByType:   "application",
			UsedByName:   "api",
			UsageContext: "clone repository",
		}},
	})
	if err != nil {
		t.Fatal(err)
	}

	if !credential.ID.Valid {
		t.Fatalf("expected credential to be returned, got %+v", credential)
	}
	expected := []string{"upsert_credential", "delete_permissions", "delete_usages", "upsert_permission", "upsert_usage"}
	if !sameStrings(queries.calls, expected) {
		t.Fatalf("unexpected write order: %+v", queries.calls)
	}
}

func TestUpsertCredentialInventoryItemStopsWhenClearingFactsFails(t *testing.T) {
	queries := &fakeCredentialInventoryQueries{deletePermissionsErr: errors.New("database unavailable")}

	_, err := upsertCredentialInventoryItem(context.Background(), queries, credentialInventoryItem{
		Name:           "GitHub deploy key",
		Provider:       "github",
		ExternalRef:    "repo:prosights/api",
		CredentialType: "deploy_key",
		Status:         "active",
		Permissions: []credentialPermissionInput{{
			ResourceType: "repository",
			ResourceName: "prosights/api",
			Permission:   "contents:read",
			Source:       "github",
		}},
	})
	if err == nil {
		t.Fatal("expected delete failure")
	}
	expected := []string{"upsert_credential", "delete_permissions"}
	if !sameStrings(queries.calls, expected) {
		t.Fatalf("expected writes to stop before new facts, got %+v", queries.calls)
	}
}

func TestUpsertCredentialInventoryBatchReturnsProviderList(t *testing.T) {
	queries := &fakeCredentialInventoryQueries{}

	credentials, providers, err := upsertCredentialInventoryBatch(context.Background(), queries, []credentialInventoryItem{
		{
			Name:           "GitHub deploy key",
			Provider:       "github",
			ExternalRef:    "repo:prosights/api",
			CredentialType: "deploy_key",
			Status:         "active",
		},
		{
			Name:           "S3 deploy role",
			Provider:       "s3",
			ExternalRef:    "arn:aws:iam::123:role/deploy",
			CredentialType: "iam_role",
			Status:         "active",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(credentials) != 2 {
		t.Fatalf("expected two credentials, got %+v", credentials)
	}
	if !sameStrings(providers, []string{"github", "s3"}) {
		t.Fatalf("unexpected providers: %+v", providers)
	}
}

func TestUpsertCredentialInventoryBatchStopsOnFirstWriteFailure(t *testing.T) {
	queries := &fakeCredentialInventoryQueries{upsertCredentialErrAfter: 1}

	_, _, err := upsertCredentialInventoryBatch(context.Background(), queries, []credentialInventoryItem{
		{
			Name:           "GitHub deploy key",
			Provider:       "github",
			ExternalRef:    "repo:prosights/api",
			CredentialType: "deploy_key",
			Status:         "active",
		},
		{
			Name:           "S3 deploy role",
			Provider:       "s3",
			ExternalRef:    "arn:aws:iam::123:role/deploy",
			CredentialType: "iam_role",
			Status:         "active",
		},
		{
			Name:           "GCS deploy role",
			Provider:       "gcs",
			ExternalRef:    "projects/prod/serviceAccounts/deploy",
			CredentialType: "service_account",
			Status:         "active",
		},
	})
	if err == nil {
		t.Fatal("expected second credential write to fail")
	}

	upsertCount := 0
	for _, call := range queries.calls {
		if call == "upsert_credential" {
			upsertCount++
		}
	}
	if upsertCount != 2 {
		t.Fatalf("expected batch to stop on second credential write, got calls %+v", queries.calls)
	}
}

type fakeCredentialInventoryQueries struct {
	calls                    []string
	deletePermissionsErr     error
	upsertCredentialCalls    int
	upsertCredentialErrAfter int
}

func (f *fakeCredentialInventoryQueries) DeleteCredentialPermissions(context.Context, pgtype.UUID) error {
	f.calls = append(f.calls, "delete_permissions")
	return f.deletePermissionsErr
}

func (f *fakeCredentialInventoryQueries) DeleteCredentialUsages(context.Context, pgtype.UUID) error {
	f.calls = append(f.calls, "delete_usages")
	return nil
}

func (f *fakeCredentialInventoryQueries) UpsertCredential(_ context.Context, params db.UpsertCredentialParams) (db.Credential, error) {
	f.calls = append(f.calls, "upsert_credential")
	f.upsertCredentialCalls++
	if f.upsertCredentialErrAfter > 0 && f.upsertCredentialCalls > f.upsertCredentialErrAfter {
		return db.Credential{}, errors.New("upsert credential failed")
	}
	return db.Credential{
		ID:             pgtype.UUID{Bytes: [16]byte{byte(f.upsertCredentialCalls)}, Valid: true},
		Name:           params.Name,
		Provider:       params.Provider,
		ExternalRef:    params.ExternalRef,
		CredentialType: params.CredentialType,
		Status:         params.Status,
	}, nil
}

func (f *fakeCredentialInventoryQueries) UpsertCredentialPermission(context.Context, db.UpsertCredentialPermissionParams) (db.CredentialPermission, error) {
	f.calls = append(f.calls, "upsert_permission")
	return db.CredentialPermission{}, nil
}

func (f *fakeCredentialInventoryQueries) UpsertCredentialUsage(context.Context, db.UpsertCredentialUsageParams) (db.CredentialUsage, error) {
	f.calls = append(f.calls, "upsert_usage")
	return db.CredentialUsage{}, nil
}

func sameStrings(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
