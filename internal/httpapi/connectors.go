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
	Config          map[string]any     `json:"config"`
	LastSyncStatus  pgtype.Text        `json:"last_sync_status"`
	LastSyncMessage pgtype.Text        `json:"last_sync_message"`
	LastSyncedAt    pgtype.Timestamptz `json:"last_synced_at"`
	CreatedAt       pgtype.Timestamptz `json:"created_at"`
	UpdatedAt       pgtype.Timestamptz `json:"updated_at"`
}

func connectorResponse(account db.ConnectorAccount) connectorAccountResponse {
	config := publicConnectorConfig(account.Config)
	return connectorAccountResponse{
		ID:              account.ID,
		Provider:        account.Provider,
		Name:            account.Name,
		Enabled:         account.Enabled,
		HasConfig:       len(config) > 0,
		Config:          config,
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

func publicConnectorConfig(raw []byte) map[string]any {
	var config map[string]any
	if err := json.Unmarshal(raw, &config); err != nil || config == nil {
		return map[string]any{}
	}
	return publicConnectorConfigMap(config)
}

func publicConnectorConfigMap(config map[string]any) map[string]any {
	public := make(map[string]any, len(config))
	for key, value := range config {
		if isSecretConfigKey(key) {
			continue
		}
		value, ok := publicConnectorConfigValue(value)
		if ok {
			public[key] = value
		}
	}
	return public
}

func publicConnectorConfigValue(value any) (any, bool) {
	switch typed := value.(type) {
	case map[string]any:
		public := publicConnectorConfigMap(typed)
		return public, len(public) > 0
	case []any:
		public := make([]any, 0, len(typed))
		for _, item := range typed {
			item, ok := publicConnectorConfigValue(item)
			if ok {
				public = append(public, item)
			}
		}
		return public, len(public) > 0
	case string:
		if looksLikeSecretMaterial(typed) {
			return nil, false
		}
		return typed, true
	case nil:
		return nil, false
	default:
		return value, true
	}
}
