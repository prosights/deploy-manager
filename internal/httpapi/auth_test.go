package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAuthRejectsProtectedRouteWithoutToken(t *testing.T) {
	handler := New(nil, nil, nil, nil, nil, GitHubWebhookConfig{}, nil, "", AuthConfig{Token: "supersecrettoken123"})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/projects", nil)
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without token, got %d", response.Code)
	}
	if got := response.Header().Get("WWW-Authenticate"); got != "Bearer" {
		t.Fatalf("expected WWW-Authenticate: Bearer, got %q", got)
	}
}

func TestAuthRejectsWrongToken(t *testing.T) {
	handler := New(nil, nil, nil, nil, nil, GitHubWebhookConfig{}, nil, "", AuthConfig{Token: "supersecrettoken123"})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/projects", nil)
	request.Header.Set("Authorization", "Bearer wrong-token")
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 with wrong token, got %d", response.Code)
	}
}

func TestAuthAllowsHealthChecksWithoutToken(t *testing.T) {
	handler := New(nil, nil, nil, nil, nil, GitHubWebhookConfig{}, nil, "", AuthConfig{Token: "supersecrettoken123"})

	for _, path := range []string{"/api/healthz", "/api/readyz"} {
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, path, nil)
		handler.ServeHTTP(response, request)
		if response.Code == http.StatusUnauthorized {
			t.Fatalf("expected %s to remain unauthenticated, got 401", path)
		}
	}
}

func TestAuthAllowsGithubWebhookWithoutToken(t *testing.T) {
	handler := New(nil, nil, nil, nil, nil, GitHubWebhookConfig{}, nil, "", AuthConfig{Token: "supersecrettoken123"})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/webhooks/github", nil)
	handler.ServeHTTP(response, request)

	// The webhook authenticates via HMAC, not the bearer token, so it must not
	// return 401 from the auth middleware (it returns 401 for invalid signature
	// instead, which is handled inside the handler, but never reaches the
	// bearer-token middleware). Either way the WWW-Authenticate Bearer header
	// must be absent.
	if got := response.Header().Get("WWW-Authenticate"); got == "Bearer" {
		t.Fatal("github webhook must not be gated by the bearer-token middleware")
	}
}

func TestAuthDisabledWhenNoTokenConfigured(t *testing.T) {
	handler := New(nil, nil, nil, nil, nil, GitHubWebhookConfig{}, nil, "", AuthConfig{})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/healthz", nil)
	handler.ServeHTTP(response, request)

	if response.Code == http.StatusUnauthorized {
		t.Fatal("auth must be disabled when no token is configured")
	}
}

func TestValidBearerTokenConstantTime(t *testing.T) {
	expected := []byte("supersecrettoken123")
	cases := []struct {
		header string
		want   bool
	}{
		{"Bearer supersecrettoken123", true},
		{"Bearer  supersecrettoken123  ", true},
		{"Bearer wrong", false},
		{"supersecrettoken123", false},
		{"Bearer ", false},
		{"", false},
	}
	for _, tc := range cases {
		if got := validBearerToken(tc.header, expected); got != tc.want {
			t.Fatalf("validBearerToken(%q) = %v, want %v", tc.header, got, tc.want)
		}
	}
}
