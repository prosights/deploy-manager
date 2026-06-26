package httpapi

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestSPAServesStaticFiles(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("index"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "asset.txt"), []byte("asset"), 0o600); err != nil {
		t.Fatal(err)
	}

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/asset.txt", nil)
	Server{static: root}.spa(response, request)

	if response.Body.String() != "asset" {
		t.Fatalf("expected asset response, got %q", response.Body.String())
	}
}

func TestSPAUsesImmutableCacheForBuiltAssets(t *testing.T) {
	root := t.TempDir()
	assets := filepath.Join(root, "assets")
	if err := os.Mkdir(assets, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(assets, "index-abc123.js"), []byte("asset"), 0o600); err != nil {
		t.Fatal(err)
	}

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/assets/index-abc123.js", nil)
	Server{static: root}.spa(response, request)

	if got := response.Header().Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Fatalf("expected immutable asset cache header, got %q", got)
	}
}

func TestSPAUsesNoCacheForIndexFallback(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("index"), 0o600); err != nil {
		t.Fatal(err)
	}

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/deployments", nil)
	Server{static: root}.spa(response, request)

	if response.Body.String() != "index" {
		t.Fatalf("expected index fallback, got %q", response.Body.String())
	}
	if got := response.Header().Get("Cache-Control"); got != "no-cache" {
		t.Fatalf("expected no-cache index header, got %q", got)
	}
}

func TestSPADoesNotFallbackForMissingBuiltAssets(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("index"), 0o600); err != nil {
		t.Fatal(err)
	}

	for _, path := range []string{"/assets/missing.js", "/favicon.ico", "/manifest.webmanifest"} {
		t.Run(path, func(t *testing.T) {
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, path, nil)
			Server{static: root}.spa(response, request)

			if response.Code != http.StatusNotFound {
				t.Fatalf("expected 404, got %d with body %q", response.Code, response.Body.String())
			}
			if response.Body.String() == "index" {
				t.Fatal("served SPA fallback for missing asset")
			}
		})
	}
}

func TestSPAFallbackStillAllowsClientRoutesWithDotsInSegments(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("index"), 0o600); err != nil {
		t.Fatal(err)
	}

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/applications/api.v2/deployments", nil)
	Server{static: root}.spa(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected SPA fallback, got %d", response.Code)
	}
	if response.Body.String() != "index" {
		t.Fatalf("expected index fallback, got %q", response.Body.String())
	}
}

func TestSPADoesNotServeFilesOutsideStaticRoot(t *testing.T) {
	parent := t.TempDir()
	root := filepath.Join(parent, "dist")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("index"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(parent, "secret.txt"), []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/../secret.txt", nil)
	Server{static: root}.spa(response, request)

	if response.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d with body %q", response.Code, response.Body.String())
	}
	if response.Body.String() == "secret" {
		t.Fatal("served file outside static root")
	}
}

func TestUnknownAPIRouteReturnsJSONNotSPA(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("index"), 0o600); err != nil {
		t.Fatal(err)
	}

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/missing", nil)
	New(nil, nil, nil, nil, nil, GitHubWebhookConfig{}, nil, root).ServeHTTP(response, request)

	if response.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", response.Code)
	}
	if got := response.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("expected JSON response, got %q", got)
	}
	if response.Body.String() == "index" {
		t.Fatal("served SPA fallback for unknown API route")
	}
}

func TestUnknownAppRouteStillUsesSPAFallback(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("index"), 0o600); err != nil {
		t.Fatal(err)
	}

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/deployments/active", nil)
	New(nil, nil, nil, nil, nil, GitHubWebhookConfig{}, nil, root).ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", response.Code)
	}
	if response.Body.String() != "index" {
		t.Fatalf("expected SPA fallback, got %q", response.Body.String())
	}
}
