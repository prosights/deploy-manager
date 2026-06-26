package httpapi

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
)

func (s Server) listCredentials(w http.ResponseWriter, r *http.Request) {
	credentials, err := s.queries.ListCredentials(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, credentials)
}

func (s Server) credentialDetail(w http.ResponseWriter, r *http.Request) {
	credentialID, err := parseUUIDParam(r, "credentialID")
	if err != nil {
		writeError(w, err)
		return
	}

	credential, err := s.queries.GetCredentialWithCounts(r.Context(), credentialID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, notFoundError("credential not found"))
			return
		}
		writeError(w, err)
		return
	}

	permissions, err := s.queries.ListCredentialPermissions(r.Context(), credentialID)
	if err != nil {
		writeError(w, err)
		return
	}
	usages, err := s.queries.ListCredentialUsages(r.Context(), credentialID)
	if err != nil {
		writeError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"credential":  credential,
		"permissions": permissions,
		"usages":      usages,
	})
}
