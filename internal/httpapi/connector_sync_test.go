package httpapi

import (
	"strings"
	"testing"

	"deploy-manager/internal/auditlog"
	"deploy-manager/internal/db"
)

func TestConnectorSyncMessageIsBoundedCleanAndRedacted(t *testing.T) {
	message := connectorSyncMessage("failed\nwith ghp_1234567890abcdef " + strings.Repeat("x", auditlog.MaxStringLength+10))

	if strings.ContainsAny(message, "\r\n\t") {
		t.Fatalf("expected connector sync message to remove control characters, got %q", message)
	}
	if strings.Contains(message, "ghp_1234567890abcdef") {
		t.Fatalf("expected connector sync message to redact secret-looking values, got %q", message)
	}
	if len(message) > auditlog.MaxStringLength {
		t.Fatalf("expected bounded connector sync message, got %d", len(message))
	}
}

func TestConnectorSyncMessageDefaultsWhenBlank(t *testing.T) {
	if got := connectorSyncMessage("\n\t"); got != "connector sync status updated" {
		t.Fatalf("expected default sync message, got %q", got)
	}
}

func TestConnectorSyncFailureMetadataUsesSanitizedMessage(t *testing.T) {
	metadata := connectorSyncFailureMetadata(db.ConnectorAccount{Provider: "github"}, "failed\nwith bearer ghp_1234567890abcdef")

	if metadata["provider"] != "github" {
		t.Fatalf("expected provider metadata, got %+v", metadata)
	}
	errorMessage, ok := metadata["error"].(string)
	if !ok {
		t.Fatalf("expected string error metadata, got %+v", metadata)
	}
	if strings.ContainsAny(errorMessage, "\r\n\t") {
		t.Fatalf("expected clean error metadata, got %q", errorMessage)
	}
	if strings.Contains(errorMessage, "ghp_1234567890abcdef") {
		t.Fatalf("expected secret-looking error metadata to be redacted, got %q", errorMessage)
	}
}
