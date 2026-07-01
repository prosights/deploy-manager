package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestReadinessReportsReadyWhenChecksPass(t *testing.T) {
	handler := New(nil, nil, nil, nil, nil, GitHubWebhookConfig{}, nil, "", AuthConfig{}, ReadinessCheck{
		Name: "database",
		Check: func(context.Context) error {
			return nil
		},
	})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/readyz", nil)
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", response.Code)
	}
	if !strings.Contains(response.Body.String(), `"status":"ready"`) {
		t.Fatalf("expected ready response, got %q", response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"database":"ok"`) {
		t.Fatalf("expected database check, got %q", response.Body.String())
	}
}

func TestReadinessReportsUnavailableWhenCheckFails(t *testing.T) {
	handler := New(nil, nil, nil, nil, nil, GitHubWebhookConfig{}, nil, "", AuthConfig{}, ReadinessCheck{
		Name: "redis",
		Check: func(context.Context) error {
			return errors.New("redis unavailable")
		},
	})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/readyz", nil)
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", response.Code)
	}
	if !strings.Contains(response.Body.String(), `"status":"unready"`) {
		t.Fatalf("expected unready response, got %q", response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"redis":"failed"`) {
		t.Fatalf("expected redis failure, got %q", response.Body.String())
	}
}

func TestHealthzRemainsCheapLiveness(t *testing.T) {
	handler := New(nil, nil, nil, nil, nil, GitHubWebhookConfig{}, nil, "", AuthConfig{}, ReadinessCheck{
		Name: "redis",
		Check: func(context.Context) error {
			return errors.New("redis unavailable")
		},
	})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/healthz", nil)
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected liveness to stay 200, got %d", response.Code)
	}
	if !strings.Contains(response.Body.String(), `"status":"ok"`) {
		t.Fatalf("expected liveness response, got %q", response.Body.String())
	}
}
