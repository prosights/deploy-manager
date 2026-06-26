package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"deploy-manager/internal/auditlog"
	"deploy-manager/internal/connectors"
	"deploy-manager/internal/db"

	"github.com/jackc/pgx/v5"
)

func (s Server) syncConnector(w http.ResponseWriter, r *http.Request) {
	connectorID, err := parseUUIDParam(r, "connectorID")
	if err != nil {
		writeError(w, err)
		return
	}

	account, err := s.queries.GetConnectorAccount(r.Context(), connectorID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, notFoundError("connector not found"))
			return
		}
		writeError(w, err)
		return
	}
	if !account.Enabled {
		writeError(w, validationError("connector is disabled"))
		return
	}

	source := s.sources[account.Provider]
	if source == nil {
		s.writeConnectorSyncFailure(w, r, account, "sync implementation unavailable")
		return
	}

	inventory, err := source.SyncCredentials(r.Context(), connectors.SyncScope{
		Name:   account.Name,
		Config: account.Config,
	})
	if err != nil {
		s.writeConnectorSyncFailure(w, r, account, fmt.Sprintf("sync connector: %s", errorString(err)))
		return
	}

	credentials, err := credentialInventoryFromConnector(inventory)
	if err != nil {
		s.writeConnectorSyncFailure(w, r, account, errorString(err))
		return
	}

	if _, _, err := s.upsertCredentialInventoryBatch(r.Context(), credentials); err != nil {
		s.writeConnectorSyncFailure(w, r, account, errorString(err))
		return
	}

	connector, err := s.markConnectorSync(r.Context(), account, "ok", fmt.Sprintf("Imported %d credential records", len(credentials)))
	if err != nil {
		writeError(w, err)
		return
	}
	s.audit(r, "connector.sync", "connector", uuidString(connector.ID), connector.Name, map[string]any{"provider": connector.Provider, "count": len(credentials)})
	writeJSON(w, http.StatusAccepted, connectorSyncResponse{Connector: connector, Count: len(credentials)})
}

type connectorSyncResponse struct {
	Connector db.ConnectorAccount `json:"connector"`
	Count     int                 `json:"count"`
}

func (s Server) markConnectorSync(ctx context.Context, account db.ConnectorAccount, status string, message string) (db.ConnectorAccount, error) {
	return s.queries.MarkConnectorSync(ctx, db.MarkConnectorSyncParams{
		Provider:        account.Provider,
		Name:            account.Name,
		LastSyncStatus:  blankStringAsText(status),
		LastSyncMessage: blankStringAsText(connectorSyncMessage(message)),
	})
}

func connectorSyncMessage(message string) string {
	message = auditlog.StringField(message)
	if message == "" {
		return "connector sync status updated"
	}
	return message
}

func (s Server) writeConnectorSyncFailure(w http.ResponseWriter, r *http.Request, account db.ConnectorAccount, message string) {
	message = connectorSyncMessage(message)
	connector, err := s.markConnectorSync(r.Context(), account, "failed", message)
	if err != nil {
		writeError(w, err)
		return
	}
	s.audit(r, "connector.sync_failed", "connector", uuidString(account.ID), account.Name, connectorSyncFailureMetadata(account, message))
	writeJSON(w, http.StatusAccepted, connectorSyncResponse{Connector: connector, Count: 0})
}

func connectorSyncFailureMetadata(account db.ConnectorAccount, message string) map[string]any {
	return map[string]any{
		"provider": account.Provider,
		"error":    connectorSyncMessage(message),
	}
}

func credentialInventoryFromConnector(values []connectors.CredentialInventory) ([]credentialInventoryItem, error) {
	if len(values) > maxCredentialInventoryBatchSize {
		return nil, validationError("connector inventory batch cannot exceed 500 credentials")
	}

	credentials := make([]credentialInventoryItem, 0, len(values))
	for _, value := range values {
		item, err := normalizeCredentialInventoryItem(credentialInventoryItem{
			Name:           value.Name,
			Provider:       value.Provider,
			ExternalRef:    value.ExternalRef,
			CredentialType: value.Type,
			Status:         value.Status,
			Permissions:    credentialPermissionsFromConnector(value.Permissions),
			Usages:         credentialUsagesFromConnector(value.Usages),
		})
		if err != nil {
			return nil, err
		}
		credentials = append(credentials, item)
	}
	return mergeCredentialInventoryItems(credentials), nil
}
