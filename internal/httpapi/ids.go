package httpapi

import (
	"net/http"
	"strings"

	"deploy-manager/internal/stringutil"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func parseUUIDParam(r *http.Request, name string) (pgtype.UUID, error) {
	value := chi.URLParam(r, name)
	id, err := stringutil.PgUUID(value)
	if err != nil {
		return pgtype.UUID{}, validationError("invalid " + name)
	}
	return id, nil
}

func uuidString(id pgtype.UUID) string {
	return stringutil.UUIDString(id)
}

func blankTextAsNull(value pgtype.Text) pgtype.Text {
	if strings.TrimSpace(value.String) == "" {
		return pgtype.Text{}
	}
	return value
}

func blankStringAsText(value string) pgtype.Text {
	value = strings.TrimSpace(value)
	if value == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: value, Valid: true}
}
