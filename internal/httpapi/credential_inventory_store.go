package httpapi

import (
	"context"
	"fmt"
	"net/http"

	"deploy-manager/internal/db"

	"github.com/jackc/pgx/v5/pgtype"
)

type credentialInventoryQueries interface {
	DeleteCredentialPermissions(context.Context, pgtype.UUID) error
	DeleteCredentialUsages(context.Context, pgtype.UUID) error
	UpsertCredential(context.Context, db.UpsertCredentialParams) (db.Credential, error)
	UpsertCredentialPermission(context.Context, db.UpsertCredentialPermissionParams) (db.CredentialPermission, error)
	UpsertCredentialUsage(context.Context, db.UpsertCredentialUsageParams) (db.CredentialUsage, error)
}

func (s Server) markInventoryConnectorsSynced(r *http.Request, providerCounts map[string]int, syncName string) {
	for provider, count := range providerCounts {
		if _, ok := allowedConnectorProviders[provider]; !ok {
			continue
		}
		_, _ = s.queries.MarkConnectorSync(r.Context(), db.MarkConnectorSyncParams{
			Provider:        provider,
			Name:            syncName,
			LastSyncStatus:  blankStringAsText("ok"),
			LastSyncMessage: blankStringAsText(fmt.Sprintf("Imported %d credential records", count)),
		})
	}
}

func (s Server) upsertCredentialInventoryItem(ctx context.Context, item credentialInventoryItem) (db.Credential, error) {
	item, err := normalizeCredentialInventoryItem(item)
	if err != nil {
		return db.Credential{}, err
	}

	if s.tx == nil {
		return upsertCredentialInventoryItem(ctx, s.queries, item)
	}

	tx, err := s.tx.Begin(ctx)
	if err != nil {
		return db.Credential{}, err
	}
	defer tx.Rollback(ctx)

	credential, err := upsertCredentialInventoryItem(ctx, s.queries.WithTx(tx), item)
	if err != nil {
		return db.Credential{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.Credential{}, err
	}
	return credential, nil
}

func (s Server) upsertCredentialInventoryBatch(ctx context.Context, items []credentialInventoryItem) ([]db.Credential, []string, error) {
	if s.tx == nil {
		return upsertCredentialInventoryBatch(ctx, s.queries, items)
	}

	tx, err := s.tx.Begin(ctx)
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback(ctx)

	credentials, providers, err := upsertCredentialInventoryBatch(ctx, s.queries.WithTx(tx), items)
	if err != nil {
		return nil, nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, nil, err
	}
	return credentials, providers, nil
}

func upsertCredentialInventoryBatch(ctx context.Context, queries credentialInventoryQueries, items []credentialInventoryItem) ([]db.Credential, []string, error) {
	credentials := make([]db.Credential, 0, len(items))
	providers := make([]string, 0, len(items))
	for _, item := range items {
		credential, err := upsertCredentialInventoryItem(ctx, queries, item)
		if err != nil {
			return nil, nil, err
		}
		credentials = append(credentials, credential)
		providers = append(providers, credential.Provider)
	}
	return credentials, providers, nil
}

func upsertCredentialInventoryItem(ctx context.Context, queries credentialInventoryQueries, item credentialInventoryItem) (db.Credential, error) {
	credential, err := queries.UpsertCredential(ctx, db.UpsertCredentialParams{
		Name:           item.Name,
		Provider:       item.Provider,
		ExternalRef:    item.ExternalRef,
		CredentialType: item.CredentialType,
		Status:         item.Status,
	})
	if err != nil {
		return db.Credential{}, err
	}

	if err := queries.DeleteCredentialPermissions(ctx, credential.ID); err != nil {
		return db.Credential{}, err
	}
	if err := queries.DeleteCredentialUsages(ctx, credential.ID); err != nil {
		return db.Credential{}, err
	}

	for _, permission := range item.Permissions {
		if err := upsertCredentialPermission(ctx, queries, credential.ID, permission); err != nil {
			return db.Credential{}, err
		}
	}
	for _, usage := range item.Usages {
		if err := upsertCredentialUsage(ctx, queries, credential.ID, usage); err != nil {
			return db.Credential{}, err
		}
	}

	return credential, nil
}

func upsertCredentialPermission(ctx context.Context, queries credentialInventoryQueries, credentialID pgtype.UUID, input credentialPermissionInput) error {
	_, err := queries.UpsertCredentialPermission(ctx, db.UpsertCredentialPermissionParams{
		CredentialID: credentialID,
		ResourceType: input.ResourceType,
		ResourceName: input.ResourceName,
		Permission:   input.Permission,
		Source:       input.Source,
	})
	return err
}

func upsertCredentialUsage(ctx context.Context, queries credentialInventoryQueries, credentialID pgtype.UUID, input credentialUsageInput) error {
	_, err := queries.UpsertCredentialUsage(ctx, db.UpsertCredentialUsageParams{
		CredentialID: credentialID,
		UsedByType:   input.UsedByType,
		UsedByName:   input.UsedByName,
		UsageContext: input.UsageContext,
	})
	return err
}
