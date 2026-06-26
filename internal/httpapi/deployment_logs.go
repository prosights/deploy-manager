package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"deploy-manager/internal/db"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const maxDeploymentLogHistory = 500

func (s Server) listDeploymentLogs(w http.ResponseWriter, r *http.Request) {
	deploymentID, err := parseUUIDParam(r, "deploymentID")
	if err != nil {
		writeError(w, err)
		return
	}
	if err := s.ensureDeploymentExists(r, deploymentID); err != nil {
		writeError(w, err)
		return
	}
	logs, err := s.queries.ListRecentDeploymentLogs(r.Context(), db.ListRecentDeploymentLogsParams{
		DeploymentID: deploymentID,
		LimitCount:   maxDeploymentLogHistory,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, logs)
}

func (s Server) streamDeploymentLogs(w http.ResponseWriter, r *http.Request) {
	deploymentID, err := parseUUIDParam(r, "deploymentID")
	if err != nil {
		writeError(w, err)
		return
	}
	if err := s.ensureDeploymentExists(r, deploymentID); err != nil {
		writeError(w, err)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, errors.New("streaming is not supported"))
		return
	}

	setSSEHeaders(w.Header())

	lastEventID := parseLastEventID(r.Header.Get("Last-Event-ID"))
	events := s.logs.Subscribe(r.Context(), uuidString(deploymentID))

	history, err := s.listDeploymentLogHistory(r.Context(), deploymentID, lastEventID)
	if err != nil {
		writeSSE(w, "error", map[string]string{"message": err.Error()})
		flusher.Flush()
		return
	}
	for _, entry := range history {
		var shouldSend bool
		shouldSend, lastEventID = advanceLastEventID(lastEventID, entry.ID)
		if !shouldSend {
			continue
		}
		writeSSEWithID(w, sseID(entry.ID), "log", entry)
	}
	flusher.Flush()

	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case event, ok := <-events:
			if !ok {
				return
			}
			var shouldSend bool
			shouldSend, lastEventID = advanceLastEventID(lastEventID, event.ID)
			if !shouldSend {
				continue
			}
			writeSSEWithID(w, sseID(event.ID), "log", event)
			flusher.Flush()
		case <-heartbeat.C:
			writeSSEComment(w, "keepalive")
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

func (s Server) listDeploymentLogHistory(ctx context.Context, deploymentID pgtype.UUID, lastEventID int64) ([]db.DeploymentLog, error) {
	if lastEventID > 0 {
		return s.queries.ListDeploymentLogsAfter(ctx, db.ListDeploymentLogsAfterParams{
			DeploymentID: deploymentID,
			LastLogID:    lastEventID,
			LimitCount:   maxDeploymentLogHistory,
		})
	}
	return s.queries.ListRecentDeploymentLogs(ctx, db.ListRecentDeploymentLogsParams{
		DeploymentID: deploymentID,
		LimitCount:   maxDeploymentLogHistory,
	})
}

func setSSEHeaders(header http.Header) {
	header.Set("Content-Type", "text/event-stream")
	header.Set("Cache-Control", "no-cache, no-transform")
	header.Set("Connection", "keep-alive")
	header.Set("X-Accel-Buffering", "no")
}

func (s Server) ensureDeploymentExists(r *http.Request, deploymentID pgtype.UUID) error {
	if _, err := s.queries.GetDeployment(r.Context(), deploymentID); err != nil {
		return deploymentLookupError(err)
	}
	return nil
}

func deploymentLookupError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return notFoundError("deployment not found")
	}
	return err
}

func parseLastEventID(value string) int64 {
	id, err := strconv.ParseInt(value, 10, 64)
	if err != nil || id < 0 {
		return 0
	}
	return id
}

func sseID(id int64) string {
	if id <= 0 {
		return ""
	}
	return strconv.FormatInt(id, 10)
}

func advanceLastEventID(lastEventID int64, eventID int64) (bool, int64) {
	if eventID <= 0 {
		return true, lastEventID
	}
	if eventID <= lastEventID {
		return false, lastEventID
	}
	return true, eventID
}
