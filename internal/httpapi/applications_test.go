package httpapi

import (
	"errors"
	"testing"

	"deploy-manager/internal/db"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestNormalizeCreateApplicationTrimsAndDefaults(t *testing.T) {
	input, err := normalizeCreateApplication(db.CreateApplicationParams{
		EnvironmentID:   pgtype.UUID{Valid: true},
		ServerID:        pgtype.UUID{Valid: true},
		Name:            " api ",
		RemoteDirectory: " /srv/api ",
		RepositoryUrl:   pgtype.Text{String: " git@github.com:acme/api.git ", Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}

	if input.Name != "api" || input.RemoteDirectory != "/srv/api" || input.Branch != "main" || input.ComposePath != "docker-compose.yml" {
		t.Fatalf("unexpected normalized application: %+v", input)
	}
	if input.RepositoryUrl.String != "git@github.com:acme/api.git" {
		t.Fatalf("expected trimmed repository URL, got %q", input.RepositoryUrl.String)
	}
}

func TestNormalizeCreateApplicationAcceptsSupportedRepositoryURLs(t *testing.T) {
	for _, repositoryURL := range []string{"git@github.com:acme/api.git", "https://github.com/acme/api", "https://github.com/acme/api.git"} {
		t.Run(repositoryURL, func(t *testing.T) {
			_, err := normalizeCreateApplication(db.CreateApplicationParams{
				EnvironmentID:   pgtype.UUID{Valid: true},
				ServerID:        pgtype.UUID{Valid: true},
				Name:            "api",
				RemoteDirectory: "/srv/api",
				RepositoryUrl:   pgtype.Text{String: repositoryURL, Valid: true},
			})
			if err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestNormalizeCreateApplicationRejectsUnsafeRepositoryURL(t *testing.T) {
	for _, repositoryURL := range []string{
		"ssh://github.com/acme/api.git",
		"https://github.com/acme/api.git\nrm -rf /",
		"github.com/acme/api",
		"https://token@github.com/acme/api.git",
		"https://gitlab.com/acme/api.git",
		"https://github.com/acme",
		"https://github.com/acme/api/actions",
		"git@github.com:acme/api",
		"git@gitlab.com:acme/api.git",
	} {
		t.Run(repositoryURL, func(t *testing.T) {
			_, err := normalizeCreateApplication(db.CreateApplicationParams{
				EnvironmentID:   pgtype.UUID{Valid: true},
				ServerID:        pgtype.UUID{Valid: true},
				Name:            "api",
				RemoteDirectory: "/srv/api",
				RepositoryUrl:   pgtype.Text{String: repositoryURL, Valid: true},
			})
			if err == nil {
				t.Fatal("expected repository URL to fail")
			}
		})
	}
}

func TestNormalizeCreateApplicationRejectsBlankRequiredFields(t *testing.T) {
	_, err := normalizeCreateApplication(db.CreateApplicationParams{
		EnvironmentID:   pgtype.UUID{Valid: true},
		ServerID:        pgtype.UUID{Valid: true},
		Name:            " ",
		RemoteDirectory: " /srv/api ",
	})
	if err == nil {
		t.Fatal("expected blank name to fail")
	}
}

func TestNormalizeCreateApplicationRejectsUnsafeBranch(t *testing.T) {
	for _, branch := range []string{"-main", "feature api", "feature..api"} {
		t.Run(branch, func(t *testing.T) {
			_, err := normalizeCreateApplication(db.CreateApplicationParams{
				EnvironmentID:   pgtype.UUID{Valid: true},
				ServerID:        pgtype.UUID{Valid: true},
				Name:            "api",
				RemoteDirectory: "/srv/api",
				Branch:          branch,
			})
			if err == nil {
				t.Fatal("expected unsafe branch to fail")
			}
		})
	}
}

func TestNormalizeCreateApplicationRejectsUnsafeRemoteDirectory(t *testing.T) {
	for _, remoteDirectory := range []string{"srv/api", "/", "/srv/../api", "/srv//api", "/srv/api\nrm -rf /"} {
		t.Run(remoteDirectory, func(t *testing.T) {
			_, err := normalizeCreateApplication(db.CreateApplicationParams{
				EnvironmentID:   pgtype.UUID{Valid: true},
				ServerID:        pgtype.UUID{Valid: true},
				Name:            "api",
				RemoteDirectory: remoteDirectory,
			})
			if err == nil {
				t.Fatal("expected remote directory to fail")
			}
		})
	}
}

func TestNormalizeCreateApplicationRequiresDopplerPair(t *testing.T) {
	_, err := normalizeCreateApplication(db.CreateApplicationParams{
		EnvironmentID:   pgtype.UUID{Valid: true},
		ServerID:        pgtype.UUID{Valid: true},
		Name:            "api",
		RemoteDirectory: "/srv/api",
		DopplerProject:  pgtype.Text{String: "billing", Valid: true},
	})
	if err == nil {
		t.Fatal("expected missing Doppler config to fail")
	}
}

func TestNormalizeCreateApplicationRejectsUnsafeDopplerScope(t *testing.T) {
	for _, input := range []struct {
		name    string
		project string
		config  string
	}{
		{name: "project control character", project: "billing\nprod", config: "prd"},
		{name: "config control character", project: "billing", config: "prd\tbad"},
	} {
		t.Run(input.name, func(t *testing.T) {
			_, err := normalizeCreateApplication(db.CreateApplicationParams{
				EnvironmentID:   pgtype.UUID{Valid: true},
				ServerID:        pgtype.UUID{Valid: true},
				Name:            "api",
				RemoteDirectory: "/srv/api",
				DopplerProject:  pgtype.Text{String: input.project, Valid: true},
				DopplerConfig:   pgtype.Text{String: input.config, Valid: true},
			})
			if err == nil {
				t.Fatal("expected unsafe Doppler scope to fail")
			}
		})
	}
}

func TestNormalizeCreateApplicationAcceptsHealthCheckURL(t *testing.T) {
	input, err := normalizeCreateApplication(db.CreateApplicationParams{
		EnvironmentID:   pgtype.UUID{Valid: true},
		ServerID:        pgtype.UUID{Valid: true},
		Name:            "api",
		RemoteDirectory: "/srv/api",
		HealthCheckUrl:  pgtype.Text{String: " http://127.0.0.1:{port}/healthz?color={color} ", Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if input.HealthCheckUrl.String != "http://127.0.0.1:{port}/healthz?color={color}" {
		t.Fatalf("expected trimmed health check URL, got %q", input.HealthCheckUrl.String)
	}
}

func TestNormalizeCreateApplicationRejectsMalformedHealthCheckURL(t *testing.T) {
	for _, healthCheckURL := range []string{"ssh://api.example.com/healthz", "https:///healthz", "https://user:pass@api.example.com/healthz", "https://api.example.com/healthz\ncurl bad"} {
		_, err := normalizeCreateApplication(db.CreateApplicationParams{
			EnvironmentID:   pgtype.UUID{Valid: true},
			ServerID:        pgtype.UUID{Valid: true},
			Name:            "api",
			RemoteDirectory: "/srv/api",
			HealthCheckUrl:  pgtype.Text{String: healthCheckURL, Valid: true},
		})
		if err == nil {
			t.Fatalf("expected malformed health check URL %q to fail", healthCheckURL)
		}
	}
}

func TestNormalizeCreateApplicationRejectsMalformedDomain(t *testing.T) {
	_, err := normalizeCreateApplication(db.CreateApplicationParams{
		EnvironmentID:   pgtype.UUID{Valid: true},
		ServerID:        pgtype.UUID{Valid: true},
		Name:            "api",
		RemoteDirectory: "/srv/api",
		Domain:          pgtype.Text{String: "example..com", Valid: true},
	})
	if err == nil {
		t.Fatal("expected malformed domain to fail")
	}
}

func TestNormalizeCreateApplicationCanonicalizesDomain(t *testing.T) {
	input, err := normalizeCreateApplication(db.CreateApplicationParams{
		EnvironmentID:   pgtype.UUID{Valid: true},
		ServerID:        pgtype.UUID{Valid: true},
		Name:            "api",
		RemoteDirectory: "/srv/api",
		Domain:          pgtype.Text{String: " API.Example.COM ", Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !input.Domain.Valid || input.Domain.String != "api.example.com" {
		t.Fatalf("expected canonical domain, got %+v", input.Domain)
	}
}

func TestApplicationLookupErrorMapsMissingServerToNotFound(t *testing.T) {
	err := applicationLookupError(pgx.ErrNoRows, "server not found")

	var notFound notFoundError
	if !errors.As(err, &notFound) {
		t.Fatalf("expected not found error, got %T", err)
	}
}

func TestValidateApplicationServerRejectsServerMoves(t *testing.T) {
	existing := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	requested := pgtype.UUID{Bytes: [16]byte{2}, Valid: true}

	if err := validateApplicationServer(existing, requested); err == nil {
		t.Fatal("expected changing a service server to fail")
	}
	if err := validateApplicationServer(existing, existing); err != nil {
		t.Fatalf("expected the existing service server to remain valid, got %v", err)
	}
}

func TestApplicationLookupErrorKeepsUnexpectedErrors(t *testing.T) {
	cause := errors.New("database down")

	if err := applicationLookupError(cause, "server not found"); !errors.Is(err, cause) {
		t.Fatalf("expected original error, got %v", err)
	}
}

func TestNormalizeCreateApplicationRejectsUnsafeComposePath(t *testing.T) {
	for _, composePath := range []string{"/etc/docker-compose.yml", "../docker-compose.yml", "deploy/../docker-compose.yml", "."} {
		_, err := normalizeCreateApplication(db.CreateApplicationParams{
			EnvironmentID:   pgtype.UUID{Valid: true},
			ServerID:        pgtype.UUID{Valid: true},
			Name:            "api",
			RemoteDirectory: "/srv/api",
			ComposePath:     composePath,
		})
		if err == nil {
			t.Fatalf("expected compose path %q to fail", composePath)
		}
	}
}
