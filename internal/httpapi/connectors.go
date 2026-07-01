package httpapi

import (
	"encoding/json"
	"net/http"

	"deploy-manager/internal/db"

	"github.com/jackc/pgx/v5/pgtype"
)

func (s Server) listConnectors(w http.ResponseWriter, r *http.Request) {
	accounts, err := s.queries.ListConnectorAccounts(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, connectorResponses(accounts))
}

func (s Server) upsertConnector(w http.ResponseWriter, r *http.Request) {
	var request upsertConnectorRequest
	if err := readJSON(w, r, &request); err != nil {
		writeError(w, err)
		return
	}
	input, err := normalizeConnectorAccount(db.UpsertConnectorAccountParams{
		Provider: request.Provider,
		Name:     request.Name,
		Enabled:  request.Enabled,
		Config:   []byte(request.Config),
	})
	if err != nil {
		writeError(w, err)
		return
	}

	connector, err := s.queries.UpsertConnectorAccount(r.Context(), input)
	if err != nil {
		writeError(w, err)
		return
	}
	s.audit(r, "connector.upsert", "connector", uuidString(connector.ID), connector.Name, map[string]any{"provider": connector.Provider, "enabled": connector.Enabled})
	writeJSON(w, http.StatusOK, connectorResponse(connector))
}

type upsertConnectorRequest struct {
	Provider string          `json:"provider"`
	Name     string          `json:"name"`
	Enabled  bool            `json:"enabled"`
	Config   json.RawMessage `json:"config"`
}

// connectorAccountResponse is the public projection of a connector account. It
// deliberately omits the raw Config blob, which may carry secret material that
// must never be echoed back over the API. Only a boolean presence flag is
// exposed so the UI can show whether configuration exists.
type connectorAccountResponse struct {
	ID              pgtype.UUID        `json:"id"`
	Provider        string             `json:"provider"`
	Name            string             `json:"name"`
	Enabled         bool               `json:"enabled"`
	HasConfig       bool               `json:"has_config"`
	LastSyncStatus  pgtype.Text        `json:"last_sync_status"`
	LastSyncMessage pgtype.Text        `json:"last_sync_message"`
	LastSyncedAt    pgtype.Timestamptz `json:"last_synced_at"`
	CreatedAt       pgtype.Timestamptz `json:"created_at"`
	UpdatedAt       pgtype.Timestamptz `json:"updated_at"`
}

func connectorResponse(account db.ConnectorAccount) connectorAccountResponse {
	return connectorAccountResponse{
		ID:              account.ID,
		Provider:        account.Provider,
		Name:            account.Name,
		Enabled:         account.Enabled,
		HasConfig:       len(account.Config) > 0 && string(account.Config) != "{}" && string(account.Config) != "null",
		LastSyncStatus:  account.LastSyncStatus,
		LastSyncMessage: account.LastSyncMessage,
		LastSyncedAt:    account.LastSyncedAt,
		CreatedAt:       account.CreatedAt,
		UpdatedAt:       account.UpdatedAt,
	}
}

func connectorResponses(accounts []db.ConnectorAccount) []connectorAccountResponse {
	responses := make([]connectorAccountResponse, 0, len(accounts))
	for _, account := range accounts {
		responses = append(responses, connectorResponse(account))
	}
	return responses
}
