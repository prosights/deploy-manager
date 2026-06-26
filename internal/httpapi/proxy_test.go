package httpapi

import (
	"errors"
	"testing"

	"deploy-manager/internal/db"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestProxyLookupErrorMapsMissingRowsToNotFound(t *testing.T) {
	err := proxyLookupError(pgx.ErrNoRows, "server not found")

	var notFound notFoundError
	if !errors.As(err, &notFound) {
		t.Fatalf("expected not found error, got %T", err)
	}
	if err.Error() != "server not found" {
		t.Fatalf("expected custom not found message, got %q", err.Error())
	}
}

func TestProxyLookupErrorKeepsUnexpectedErrors(t *testing.T) {
	cause := errors.New("database unavailable")

	if err := proxyLookupError(cause, "server not found"); !errors.Is(err, cause) {
		t.Fatalf("expected original error, got %v", err)
	}
}

func TestProxyApplyFailureMetadataIncludesFailureEvidence(t *testing.T) {
	metadata := proxyApplyFailureMetadata(errors.New("reload failed"))

	if metadata["status"] != "failed" || metadata["error"] != "reload failed" {
		t.Fatalf("unexpected proxy apply failure metadata: %+v", metadata)
	}
}

func TestNormalizeCreateProxyRouteCanonicalizesDirectInput(t *testing.T) {
	input := normalizeCreateProxyRoute(db.CreateProxyRouteParams{
		ServerID:    pgtype.UUID{Valid: true},
		Domain:      " API.Example.COM ",
		UpstreamUrl: " http://127.0.0.1:8080 ",
	}, nil)

	if input.Domain != "api.example.com" {
		t.Fatalf("expected lowercase domain, got %q", input.Domain)
	}
	if input.UpstreamUrl != "http://127.0.0.1:8080" {
		t.Fatalf("expected trimmed upstream URL, got %q", input.UpstreamUrl)
	}
}

func TestNormalizeCreateProxyRouteCanonicalizesApplicationFallbackDomain(t *testing.T) {
	serverID := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	input := normalizeCreateProxyRoute(db.CreateProxyRouteParams{
		ApplicationID: pgtype.UUID{Bytes: [16]byte{2}, Valid: true},
		UpstreamUrl:   " http://127.0.0.1:8080 ",
	}, &db.Application{
		ServerID: serverID,
		Domain:   pgtype.Text{String: " API.Example.COM ", Valid: true},
	})

	if input.ServerID != serverID {
		t.Fatalf("expected application server ID, got %+v", input.ServerID)
	}
	if input.Domain != "api.example.com" {
		t.Fatalf("expected lowercase fallback domain, got %q", input.Domain)
	}
	if input.UpstreamUrl != "http://127.0.0.1:8080" {
		t.Fatalf("expected trimmed upstream URL, got %q", input.UpstreamUrl)
	}
}
