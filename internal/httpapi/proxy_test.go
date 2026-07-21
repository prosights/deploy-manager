package httpapi

import (
	"encoding/json"
	"errors"
	"strings"
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

func TestDeriveProxyRouteInputAllocatesPlaygroundBlueGreenPorts(t *testing.T) {
	applicationID := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	serverID := pgtype.UUID{Bytes: [16]byte{2}, Valid: true}
	metadata, err := json.Marshal([]githubComposeService{{
		Name:  "web",
		Ports: []githubComposePort{{ContainerPort: 3042, PublishedPort: 3043, Variable: "WEB_DEPLOY_PORT"}},
	}})
	if err != nil {
		t.Fatal(err)
	}

	input, err := deriveProxyRouteInput(db.CreateProxyRouteParams{
		ApplicationID:  applicationID,
		ComposeService: pgtype.Text{String: "web", Valid: true},
		ContainerPort:  pgtype.Int4{Int32: 3042, Valid: true},
		Domain:         "alleyes.localhost",
		TlsEnabled:     true,
	}, db.Application{ID: applicationID, ServerID: serverID, Name: "alleyes", ComposeServices: metadata}, db.Server{ID: serverID, Hostname: "playground", ProxyType: "caddy"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if input.UpstreamUrl != "http://host.docker.internal:3043" || input.BlueUpstreamUrl.String != "http://host.docker.internal:3043" || input.GreenUpstreamUrl.String != "http://host.docker.internal:3044" {
		t.Fatalf("unexpected derived upstreams: %+v", input)
	}
	if input.TlsEnabled || !input.PortVariable.Valid || input.PortVariable.String != "WEB_DEPLOY_PORT" {
		t.Fatalf("unexpected managed route metadata: %+v", input)
	}
}

func TestDeriveProxyRouteInputReusesPortsForDomainAlias(t *testing.T) {
	applicationID := pgtype.UUID{Bytes: [16]byte{3}, Valid: true}
	serverID := pgtype.UUID{Bytes: [16]byte{4}, Valid: true}
	metadata, _ := json.Marshal([]githubComposeService{{
		Name:  "web",
		Ports: []githubComposePort{{ContainerPort: 3042, PublishedPort: 3043, Variable: "DEPLOY_PORT"}},
	}})
	existing := db.ProxyRoute{
		ApplicationID:    applicationID,
		Domain:           "alleyes.prosights.co",
		UpstreamUrl:      "http://127.0.0.1:3044",
		BlueUpstreamUrl:  pgtype.Text{String: "http://127.0.0.1:3043", Valid: true},
		GreenUpstreamUrl: pgtype.Text{String: "http://127.0.0.1:3044", Valid: true},
		ComposeService:   pgtype.Text{String: "web", Valid: true},
		ContainerPort:    pgtype.Int4{Int32: 3042, Valid: true},
		PortVariable:     pgtype.Text{String: "DEPLOY_PORT", Valid: true},
	}
	input, err := deriveProxyRouteInput(db.CreateProxyRouteParams{
		ApplicationID:  applicationID,
		ComposeService: pgtype.Text{String: "web", Valid: true},
		ContainerPort:  pgtype.Int4{Int32: 3042, Valid: true},
		Domain:         "alleyes-api.prosights.co",
	}, db.Application{ID: applicationID, ServerID: serverID, Name: "alleyes", ComposeServices: metadata}, db.Server{ID: serverID, Hostname: "internal", ProxyType: "caddy"}, []db.ProxyRoute{existing})
	if err != nil {
		t.Fatal(err)
	}
	if input.UpstreamUrl != existing.UpstreamUrl || input.BlueUpstreamUrl.String != existing.BlueUpstreamUrl.String || input.GreenUpstreamUrl.String != existing.GreenUpstreamUrl.String {
		t.Fatalf("expected alias to reuse active endpoint ports, got %+v", input)
	}
}

func TestDeriveProxyRouteInputAllocatesPortsWithoutComposeVariable(t *testing.T) {
	applicationID := pgtype.UUID{Bytes: [16]byte{7}, Valid: true}
	serverID := pgtype.UUID{Bytes: [16]byte{8}, Valid: true}
	metadata, _ := json.Marshal([]githubComposeService{{Name: "web"}})

	input, err := deriveProxyRouteInput(db.CreateProxyRouteParams{
		ApplicationID:  applicationID,
		ComposeService: pgtype.Text{String: "web", Valid: true},
		ContainerPort:  pgtype.Int4{Int32: 3000, Valid: true},
		Domain:         "app.example.com",
	}, db.Application{ID: applicationID, ServerID: serverID, ComposeServices: metadata}, db.Server{ID: serverID, Hostname: "internal", ProxyType: "caddy"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if input.BlueUpstreamUrl.String != "http://127.0.0.1:20000" || input.GreenUpstreamUrl.String != "http://127.0.0.1:20001" {
		t.Fatalf("expected automatically allocated upstreams, got %+v", input)
	}
	if input.PortVariable.Valid {
		t.Fatalf("expected Deploy Manager-owned port mapping, got %+v", input.PortVariable)
	}
}

func TestDeriveProxyRouteInputRequiresDomain(t *testing.T) {
	applicationID := pgtype.UUID{Bytes: [16]byte{9}, Valid: true}
	serverID := pgtype.UUID{Bytes: [16]byte{10}, Valid: true}
	_, err := deriveProxyRouteInput(db.CreateProxyRouteParams{
		ApplicationID:  applicationID,
		ComposeService: pgtype.Text{String: "web", Valid: true},
		ContainerPort:  pgtype.Int4{Int32: 3000, Valid: true},
	}, db.Application{ID: applicationID, ServerID: serverID}, db.Server{ID: serverID}, nil)
	if err == nil || !strings.Contains(err.Error(), "domain is required") {
		t.Fatalf("expected domain validation error, got %v", err)
	}
}

func TestDeriveProxyRouteInputRequiresDistinctManagedPortVariables(t *testing.T) {
	applicationID := pgtype.UUID{Bytes: [16]byte{5}, Valid: true}
	serverID := pgtype.UUID{Bytes: [16]byte{6}, Valid: true}
	metadata, _ := json.Marshal([]githubComposeService{
		{Name: "web", Ports: []githubComposePort{{ContainerPort: 3042, PublishedPort: 3043, Variable: "DEPLOY_PORT"}}},
		{Name: "api", Ports: []githubComposePort{{ContainerPort: 8003, PublishedPort: 8004, Variable: "DEPLOY_PORT"}}},
	})
	existing := db.ProxyRoute{
		ApplicationID:    applicationID,
		BlueUpstreamUrl:  pgtype.Text{String: "http://127.0.0.1:3043", Valid: true},
		GreenUpstreamUrl: pgtype.Text{String: "http://127.0.0.1:3044", Valid: true},
		ComposeService:   pgtype.Text{String: "web", Valid: true},
		ContainerPort:    pgtype.Int4{Int32: 3042, Valid: true},
		PortVariable:     pgtype.Text{String: "DEPLOY_PORT", Valid: true},
	}
	_, err := deriveProxyRouteInput(db.CreateProxyRouteParams{
		ApplicationID:  applicationID,
		ComposeService: pgtype.Text{String: "api", Valid: true},
		ContainerPort:  pgtype.Int4{Int32: 8003, Valid: true},
		Domain:         "api.example.com",
	}, db.Application{ID: applicationID, ServerID: serverID, ComposeServices: metadata}, db.Server{ID: serverID, Hostname: "internal", ProxyType: "caddy"}, []db.ProxyRoute{existing})
	if err == nil || !strings.Contains(err.Error(), "own port variable") {
		t.Fatalf("expected duplicate variable validation error, got %v", err)
	}
}
