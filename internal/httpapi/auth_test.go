package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
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

	for _, path := range []string{"/api/webhooks/github", "/api/github/webhook"} {
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, path, nil)
		handler.ServeHTTP(response, request)

		// The webhook authenticates via HMAC, not the bearer token, so it must not
		// return 401 from the auth middleware (it returns 401 for invalid signature
		// instead, which is handled inside the handler, but never reaches the
		// bearer-token middleware). Either way the WWW-Authenticate Bearer header
		// must be absent.
		if got := response.Header().Get("WWW-Authenticate"); got == "Bearer" {
			t.Fatalf("github webhook %s must not be gated by the bearer-token middleware", path)
		}
	}
}

func TestAuthDisabledOnlyWhenExplicitlyConfigured(t *testing.T) {
	handler := New(nil, nil, nil, nil, nil, GitHubWebhookConfig{}, nil, "", AuthConfig{Disabled: true})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/healthz", nil)
	handler.ServeHTTP(response, request)

	if response.Code == http.StatusUnauthorized {
		t.Fatal("auth must be disabled when explicitly configured")
	}
}

func TestAuthRejectsQueryToken(t *testing.T) {
	handler := New(nil, nil, nil, nil, nil, GitHubWebhookConfig{}, nil, "", AuthConfig{Token: "supersecrettoken123"})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/projects?access_token=supersecrettoken123", nil)
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected query token to be rejected, got %d", response.Code)
	}
}

func TestLoginLogoutSessionFlow(t *testing.T) {
	const token = "supersecrettoken123"
	handler := New(nil, nil, nil, nil, nil, GitHubWebhookConfig{}, nil, "", AuthConfig{Token: token})

	// Wrong token is rejected and sets no cookie.
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/login", strings.NewReader(`{"token":"wrong"}`))
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for wrong login token, got %d", response.Code)
	}
	if len(response.Result().Cookies()) != 0 {
		t.Fatal("failed login must not set a cookie")
	}

	// Correct token sets the HttpOnly session cookie.
	response = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodPost, "/api/login", strings.NewReader(`{"token":"`+token+`"}`))
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("expected 204 for valid login, got %d", response.Code)
	}
	cookies := response.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != sessionCookieName || !cookies[0].HttpOnly || !cookies[0].Secure {
		t.Fatalf("expected one HttpOnly Secure %s cookie, got %+v", sessionCookieName, cookies)
	}

	// The session endpoint recognizes the cookie.
	response = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodGet, "/api/session", nil)
	request.AddCookie(cookies[0])
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"authenticated":true`) {
		t.Fatalf("expected authenticated session with cookie, got %d %s", response.Code, response.Body.String())
	}

	// Logout clears the cookie.
	response = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodPost, "/api/logout", nil)
	handler.ServeHTTP(response, request)
	cleared := response.Result().Cookies()
	if len(cleared) != 1 || cleared[0].Value != "" || cleared[0].MaxAge >= 0 || !cleared[0].Secure {
		t.Fatalf("expected logout to expire the session cookie, got %+v", cleared)
	}

	// Without a cookie the session reports unauthenticated.
	response = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodGet, "/api/session", nil)
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"authenticated":false`) {
		t.Fatalf("expected unauthenticated session without cookie, got %d %s", response.Code, response.Body.String())
	}
}

func TestCookieAuthRequiresSameOriginForUnsafeMethods(t *testing.T) {
	const token = "supersecrettoken123"
	protected := requireAuth(token)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	tests := []struct {
		name   string
		method string
		origin string
		bearer bool
		want   int
	}{
		{name: "safe cookie request", method: http.MethodGet, want: http.StatusNoContent},
		{name: "same-origin cookie request", method: http.MethodPost, origin: "https://deploy.internal.prosights.co", want: http.StatusNoContent},
		{name: "missing origin", method: http.MethodPost, want: http.StatusUnauthorized},
		{name: "insecure same-host origin", method: http.MethodPost, origin: "http://deploy.internal.prosights.co", want: http.StatusUnauthorized},
		{name: "cross-origin cookie request", method: http.MethodPost, origin: "https://other.prosights.co", want: http.StatusUnauthorized},
		{name: "bearer automation", method: http.MethodPost, bearer: true, want: http.StatusNoContent},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			request := httptest.NewRequest(test.method, "https://deploy.internal.prosights.co/api/protected", nil)
			if test.bearer {
				request.Header.Set("Authorization", "Bearer "+token)
			} else {
				request.AddCookie(&http.Cookie{Name: sessionCookieName, Value: token})
			}
			if test.origin != "" {
				request.Header.Set("Origin", test.origin)
			}
			protected.ServeHTTP(response, request)
			if response.Code != test.want {
				t.Fatalf("expected %d, got %d", test.want, response.Code)
			}
		})
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
