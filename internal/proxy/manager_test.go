package proxy

import (
	"context"
	"errors"
	"strings"
	"testing"

	"deploy-manager/internal/db"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestBuildCommandForCaddy(t *testing.T) {
	command, err := BuildCommand(Target{
		Domain:     "app.example.com",
		Upstream:   "http://127.0.0.1:3000",
		TLSEnabled: true,
		ProxyType:  "caddy",
	})
	if err != nil {
		t.Fatal(err)
	}

	assertContains(t, command, "/etc/caddy/conf.d/deploy-manager-app-example-com.caddy")
	assertContains(t, command, "/opt/infrastructure/Caddyfile")
	assertContains(t, command, "reverse_proxy http://127.0.0.1:3000")
	assertContains(t, command, "sudo systemctl reload caddy")
	assertContains(t, command, "docker exec caddy caddy reload --config /etc/caddy/Caddyfile")
}

func TestBuildCommandForTraefikWithoutTLS(t *testing.T) {
	command, err := BuildCommand(Target{
		Domain:     "api.example.com",
		Upstream:   "http://10.0.0.4:8080",
		TLSEnabled: false,
		ProxyType:  "traefik",
	})
	if err != nil {
		t.Fatal(err)
	}

	assertContains(t, command, "/etc/traefik/dynamic/deploy-manager-api-example-com.yml")
	assertContains(t, command, "entryPoints:")
	assertContains(t, command, "- web")
	if strings.Contains(command, "tls: {}") {
		t.Fatal("expected TLS to be omitted when disabled")
	}
}

func TestBuildRemoveCommandForManagedRoutes(t *testing.T) {
	caddy, err := BuildRemoveCommand("app.example.com", "caddy")
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{
		"deploy-manager-app-example-com.caddy",
		"DM_CADDY_ADDRESS",
		"docker exec caddy caddy reload",
	} {
		assertContains(t, caddy, expected)
	}

	traefik, err := BuildRemoveCommand("app.example.com", "traefik")
	if err != nil {
		t.Fatal(err)
	}
	assertContains(t, traefik, "rm -f '/etc/traefik/dynamic/deploy-manager-app-example-com.yml'")
}

func TestBuildRemoveCommandRejectsUnsafeDomain(t *testing.T) {
	if _, err := BuildRemoveCommand("app.example.com;rm -rf /", "caddy"); err == nil {
		t.Fatal("expected unsafe domain to be rejected")
	}
}

func TestBuildCommandRejectsUnsafeDomain(t *testing.T) {
	_, err := BuildCommand(Target{
		Domain:     "app.example.com;rm -rf /",
		Upstream:   "http://127.0.0.1:3000",
		TLSEnabled: true,
		ProxyType:  "caddy",
	})
	if err == nil {
		t.Fatal("expected unsafe domain to be rejected")
	}
}

func TestBuildCommandRejectsMalformedDomains(t *testing.T) {
	for _, domain := range []string{"example..com", "-app.example.com", "app-.example.com", strings.Repeat("a", 64) + ".example.com"} {
		_, err := BuildCommand(Target{
			Domain:     domain,
			Upstream:   "http://127.0.0.1:3000",
			TLSEnabled: true,
			ProxyType:  "caddy",
		})
		if err == nil {
			t.Fatalf("expected domain %q to fail", domain)
		}
	}
}

func TestBuildCommandRejectsUnsupportedUpstreamScheme(t *testing.T) {
	_, err := BuildCommand(Target{
		Domain:     "app.example.com",
		Upstream:   "ssh://127.0.0.1:3000",
		TLSEnabled: true,
		ProxyType:  "caddy",
	})
	if err == nil {
		t.Fatal("expected unsupported upstream scheme to be rejected")
	}
}

func TestBuildCommandRejectsRelativeUpstream(t *testing.T) {
	_, err := BuildCommand(Target{
		Domain:     "app.example.com",
		Upstream:   "/internal",
		TLSEnabled: true,
		ProxyType:  "caddy",
	})
	if err == nil {
		t.Fatal("expected relative upstream to be rejected")
	}
}

func TestBuildCommandRejectsControlCharacterUpstream(t *testing.T) {
	for _, upstream := range []string{"http://127.0.0.1:3000\nx", "http://127.0.0.1:\t3000"} {
		_, err := BuildCommand(Target{
			Domain:     "app.example.com",
			Upstream:   upstream,
			TLSEnabled: true,
			ProxyType:  "caddy",
		})
		if err == nil {
			t.Fatalf("expected upstream %q to be rejected", upstream)
		}
	}
}

func TestBuildCommandRejectsCredentialBearingUpstream(t *testing.T) {
	_, err := BuildCommand(Target{
		Domain:     "app.example.com",
		Upstream:   "https://user:password@127.0.0.1:8443",
		TLSEnabled: true,
		ProxyType:  "caddy",
	})
	if err == nil {
		t.Fatal("expected upstream credentials to be rejected")
	}
}

func TestBuildCommandRejectsUpstreamWithPathQueryOrFragment(t *testing.T) {
	for _, upstream := range []string{
		"http://127.0.0.1:3000/api",
		"http://127.0.0.1:3000?target=api",
		"http://127.0.0.1:3000#api",
	} {
		t.Run(upstream, func(t *testing.T) {
			_, err := BuildCommand(Target{
				Domain:     "app.example.com",
				Upstream:   upstream,
				TLSEnabled: true,
				ProxyType:  "caddy",
			})
			if err == nil {
				t.Fatal("expected upstream with path, query, or fragment to be rejected")
			}
		})
	}
}

func TestValidateTargetAllowsSupportedProxyTargets(t *testing.T) {
	err := ValidateTarget(Target{
		Domain:     "app.example.com",
		Upstream:   "https://127.0.0.1:8443",
		TLSEnabled: true,
		ProxyType:  "traefik",
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestValidateTargetRejectsMetadataAndUnsafeUpstreams(t *testing.T) {
	for _, upstream := range []string{
		"http://169.254.169.254",
		"http://metadata.google.internal",
		"http://127.0.0.1:8080`",
		"http://127.0.0.1:8080\u00a0",
	} {
		t.Run(upstream, func(t *testing.T) {
			err := ValidateTarget(Target{
				Domain:     "app.example.com",
				Upstream:   upstream,
				TLSEnabled: true,
				ProxyType:  "caddy",
			})
			if err == nil {
				t.Fatal("expected unsafe upstream to fail")
			}
		})
	}
}

func TestValidateTargetRejectsProxyDisabledServers(t *testing.T) {
	err := ValidateTarget(Target{
		Domain:     "app.example.com",
		Upstream:   "http://127.0.0.1:3000",
		TLSEnabled: true,
		ProxyType:  "none",
	})
	if err == nil {
		t.Fatal("expected disabled proxy target to fail")
	}
}

func TestValidateDomainAllowsWellFormedDomain(t *testing.T) {
	if err := ValidateDomain(" App.Example-1.com "); err != nil {
		t.Fatal(err)
	}
}

func TestManagerMarksRouteFailedWhenServerHasNoSSHKey(t *testing.T) {
	routeID := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	queries := &fakeProxyQueries{
		target: db.GetProxyRouteTargetRow{
			ID:          routeID,
			Domain:      "app.example.com",
			UpstreamUrl: "http://127.0.0.1:3000",
			ProxyType:   "caddy",
		},
	}
	manager := NewManager(queries)

	_, err := manager.Apply(context.Background(), routeID)
	if err == nil {
		t.Fatal("expected missing ssh key to fail")
	}
	if len(queries.failed) != 1 || queries.failed[0] != routeID {
		t.Fatalf("expected route to be marked failed, got %+v", queries.failed)
	}
}

func TestManagerReturnsStatusWriteFailureWhenRouteCannotBeMarkedFailed(t *testing.T) {
	routeID := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	queries := &fakeProxyQueries{
		target: db.GetProxyRouteTargetRow{
			ID:          routeID,
			Domain:      "app.example.com",
			UpstreamUrl: "http://127.0.0.1:3000",
			ProxyType:   "caddy",
		},
		markFailedErr: errors.New("database unavailable"),
	}
	manager := NewManager(queries)

	_, err := manager.Apply(context.Background(), routeID)
	if err == nil {
		t.Fatal("expected missing ssh key and status write failure")
	}
	if !strings.Contains(err.Error(), "server ssh_key_path is required") {
		t.Fatalf("expected original failure in error, got %q", err.Error())
	}
	if !strings.Contains(err.Error(), "mark proxy route failed: database unavailable") {
		t.Fatalf("expected status write failure in error, got %q", err.Error())
	}
}

func TestRemoteProxyOutputCleansControlCharacters(t *testing.T) {
	got := remoteProxyOutput(" reload\nfailed\tbecause config is invalid ")

	if strings.ContainsAny(got, "\r\n\t") {
		t.Fatalf("expected control characters removed, got %q", got)
	}
	if got != "reload failed because config is invalid" {
		t.Fatalf("unexpected cleaned output %q", got)
	}
}

func TestRemoteProxyOutputBoundsLongOutput(t *testing.T) {
	got := remoteProxyOutput(strings.Repeat("x", maxRemoteProxyOutputLength+10))

	if len(got) > maxRemoteProxyOutputLength+len("...[truncated]") {
		t.Fatalf("expected bounded output, got %d", len(got))
	}
	if !strings.HasSuffix(got, "...[truncated]") {
		t.Fatalf("expected truncation marker, got %q", got)
	}
}

func TestRemoteProxyOutputReturnsBlankForEmptyOutput(t *testing.T) {
	if got := remoteProxyOutput(" \n\t "); got != "" {
		t.Fatalf("expected blank output, got %q", got)
	}
}

func assertContains(t *testing.T, value string, expected string) {
	t.Helper()
	if !strings.Contains(value, expected) {
		t.Fatalf("expected %q to contain %q", value, expected)
	}
}

type fakeProxyQueries struct {
	target        db.GetProxyRouteTargetRow
	failed        []pgtype.UUID
	markFailedErr error
}

func (f *fakeProxyQueries) GetProxyRouteTarget(context.Context, pgtype.UUID) (db.GetProxyRouteTargetRow, error) {
	return f.target, nil
}

func (f *fakeProxyQueries) MarkProxyRouteApplied(context.Context, pgtype.UUID) (db.ProxyRoute, error) {
	return db.ProxyRoute{}, nil
}

func (f *fakeProxyQueries) MarkProxyRouteFailed(_ context.Context, id pgtype.UUID) (db.ProxyRoute, error) {
	f.failed = append(f.failed, id)
	if f.markFailedErr != nil {
		return db.ProxyRoute{}, f.markFailedErr
	}
	return db.ProxyRoute{ID: id, Status: "failed"}, nil
}
