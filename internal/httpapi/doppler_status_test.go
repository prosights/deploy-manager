package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"deploy-manager/internal/connectors"
	"deploy-manager/internal/doppler"
)

func TestDopplerReadyStatusReturnsEmptyMissingList(t *testing.T) {
	runtime := doppler.NewWithCommand("", "", "token-123", "true")
	handler := New(nil, nil, nil, nil, nil, GitHubWebhookConfig{}, map[string]connectors.Connector{
		"doppler": runtime,
	}, "", AuthConfig{Disabled: true})
	request := httptest.NewRequest(http.MethodGet, "/api/doppler/status", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", response.Code)
	}
	if body := response.Body.String(); !strings.Contains(body, `"ready":true`) || !strings.Contains(body, `"missing":[]`) {
		t.Fatalf("expected ready status with an empty missing list, got %s", body)
	}
}

func TestDopplerStatusRequiresToken(t *testing.T) {
	runtime := doppler.NewWithCommand("", "", "", "true")
	handler := New(nil, nil, nil, nil, nil, GitHubWebhookConfig{}, map[string]connectors.Connector{
		"doppler": runtime,
	}, "", AuthConfig{Disabled: true})
	request := httptest.NewRequest(http.MethodGet, "/api/doppler/status", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", response.Code)
	}
	body := response.Body.String()
	if !strings.Contains(body, `"cli_available":true`) || !strings.Contains(body, `"ready":false`) || !strings.Contains(body, `"DOPPLER_TOKEN"`) {
		t.Fatalf("expected missing token status, got %s", body)
	}
}
