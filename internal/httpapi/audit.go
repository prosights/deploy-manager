package httpapi

import (
	"encoding/json"
	"net"
	"net/http"
	"strconv"
	"strings"

	"deploy-manager/internal/auditlog"
	"deploy-manager/internal/db"

	"github.com/jackc/pgx/v5/pgtype"
)

const (
	defaultAuditEventLimit = 100
	maxAuditEventLimit     = 500
)

func (s Server) listAuditEvents(w http.ResponseWriter, r *http.Request) {
	limit, err := auditEventLimit(r.URL.Query().Get("limit"))
	if err != nil {
		writeError(w, err)
		return
	}
	events, err := s.queries.ListAuditEvents(r.Context(), limit)
	if err != nil {
		writeError(w, err)
		return
	}
	response := make([]auditEventResponse, 0, len(events))
	for _, event := range events {
		response = append(response, auditEventResponse{
			ID:         event.ID,
			Actor:      event.Actor,
			Action:     event.Action,
			TargetType: event.TargetType,
			TargetID:   event.TargetID,
			TargetName: event.TargetName,
			Metadata:   json.RawMessage(event.Metadata),
			CreatedAt:  event.CreatedAt,
		})
	}
	writeJSON(w, http.StatusOK, response)
}

func auditEventLimit(value string) (int32, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return defaultAuditEventLimit, nil
	}
	limit, err := strconv.ParseInt(value, 10, 32)
	if err != nil || limit < 1 {
		return 0, validationError("audit event limit must be a positive integer")
	}
	if limit > maxAuditEventLimit {
		return maxAuditEventLimit, nil
	}
	return int32(limit), nil
}

type auditEventResponse struct {
	ID         int64              `json:"id"`
	Actor      string             `json:"actor"`
	Action     string             `json:"action"`
	TargetType string             `json:"target_type"`
	TargetID   string             `json:"target_id"`
	TargetName string             `json:"target_name"`
	Metadata   json.RawMessage    `json:"metadata"`
	CreatedAt  pgtype.Timestamptz `json:"created_at"`
}

func (s Server) audit(r *http.Request, action string, targetType string, targetID string, targetName string, metadata map[string]any) {
	_, _ = s.queries.AppendAuditEvent(r.Context(), db.AppendAuditEventParams{
		Actor:      auditActor(r),
		Action:     auditIdentityField(action, "unknown"),
		TargetType: auditIdentityField(targetType, "unknown"),
		TargetID:   auditIdentityField(targetID, "unknown"),
		TargetName: auditIdentityField(targetName, "unknown"),
		Metadata:   auditlog.Metadata(metadata),
	})
}

func auditActor(r *http.Request) string {
	for _, header := range []string{"X-Deploy-Actor", "X-GitHub-Delivery"} {
		value := normalizeAuditActor(r.Header.Get(header))
		if value != "" {
			return value
		}
	}
	if r.RemoteAddr != "" {
		return normalizeRemoteActor(r.RemoteAddr)
	}
	return "system"
}

func normalizeRemoteActor(remoteAddr string) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err == nil {
		return normalizeAuditActor(host)
	}
	return normalizeAuditActor(remoteAddr)
}

func normalizeAuditActor(value string) string {
	return auditIdentityField(value, "")
}

func auditIdentityField(value string, fallback string) string {
	return auditlog.IdentityField(value, fallback)
}
