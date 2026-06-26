package httpapi

import (
	"encoding/json"
	"net/http"

	"deploy-manager/internal/db"
)

func (s Server) listConnectors(w http.ResponseWriter, r *http.Request) {
	connectors, err := s.queries.ListConnectorAccounts(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, connectors)
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
	writeJSON(w, http.StatusOK, connector)
}

type upsertConnectorRequest struct {
	Provider string          `json:"provider"`
	Name     string          `json:"name"`
	Enabled  bool            `json:"enabled"`
	Config   json.RawMessage `json:"config"`
}
