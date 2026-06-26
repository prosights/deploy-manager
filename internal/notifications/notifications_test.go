package notifications

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSlackSendsDeploymentMessage(t *testing.T) {
	var payload map[string]string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("expected POST, got %s", r.Method)
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	err := (Slack{WebhookURL: server.URL}).NotifyDeployment(t.Context(), DeploymentEvent{
		ApplicationName: "api",
		ServerName:      "prod-1",
		Status:          "succeeded",
		CommitSHA:       "abc123",
	})
	if err != nil {
		t.Fatal(err)
	}
	if payload["text"] == "" || payload["text"] == "succeeded" {
		t.Fatalf("unexpected payload: %+v", payload)
	}
}

func TestSlackTrimsWebhookURL(t *testing.T) {
	called := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	err := (Slack{WebhookURL: " " + server.URL + " "}).NotifyDeployment(t.Context(), DeploymentEvent{Status: "succeeded"})
	if err != nil {
		t.Fatal(err)
	}
	if !called {
		t.Fatal("expected Slack webhook to be called")
	}
}

func TestResendSkipsWhenSecretsAreMissing(t *testing.T) {
	err := (Resend{}).NotifyDeployment(t.Context(), DeploymentEvent{Status: "failed"})
	if err != nil {
		t.Fatal(err)
	}
}

func TestResendSendsDeploymentEmail(t *testing.T) {
	var auth string
	var payload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth = r.Header.Get("Authorization")
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()

	err := (Resend{
		APIKey:      "secret",
		From:        "deploy@example.com",
		To:          "ops@example.com",
		APIEndpoint: server.URL,
	}).NotifyDeployment(t.Context(), DeploymentEvent{
		ApplicationName: "worker",
		ServerName:      "prod-2",
		Status:          "failed",
		Error:           "compose failed",
	})
	if err != nil {
		t.Fatal(err)
	}
	if auth != "Bearer secret" {
		t.Fatalf("unexpected auth header %q", auth)
	}
	if payload["subject"] != "Deployment failed: worker" {
		t.Fatalf("unexpected payload: %+v", payload)
	}
}

func TestResendTrimsRequestFields(t *testing.T) {
	var auth string
	var payload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth = r.Header.Get("Authorization")
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()

	err := (Resend{
		APIKey:      " secret ",
		From:        " deploy@example.com ",
		To:          " ops@example.com ",
		APIEndpoint: " " + server.URL + " ",
	}).NotifyDeployment(t.Context(), DeploymentEvent{ApplicationName: "api", Status: "succeeded"})
	if err != nil {
		t.Fatal(err)
	}
	if auth != "Bearer secret" {
		t.Fatalf("expected trimmed API key, got %q", auth)
	}
	if payload["from"] != "deploy@example.com" {
		t.Fatalf("expected trimmed sender, got %+v", payload)
	}
	recipients, ok := payload["to"].([]any)
	if !ok || len(recipients) != 1 || recipients[0] != "ops@example.com" {
		t.Fatalf("expected trimmed recipient, got %+v", payload)
	}
}

func TestNotificationErrorIncludesResponseSnippet(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "invalid webhook", http.StatusBadRequest)
	}))
	defer server.Close()

	err := (Slack{WebhookURL: server.URL}).NotifyDeployment(t.Context(), DeploymentEvent{Status: "failed"})
	if err == nil {
		t.Fatal("expected failed notification")
	}
	if !strings.Contains(err.Error(), "status 400: invalid webhook") {
		t.Fatalf("expected response snippet, got %q", err.Error())
	}
}

func TestNotificationErrorRedactsSecretLookingResponseSnippet(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "token ghp_1234567890abcdef rejected", http.StatusUnauthorized)
	}))
	defer server.Close()

	err := (Slack{WebhookURL: server.URL}).NotifyDeployment(t.Context(), DeploymentEvent{Status: "failed"})
	if err == nil {
		t.Fatal("expected failed notification")
	}
	if strings.Contains(err.Error(), "ghp_1234567890abcdef") || !strings.Contains(err.Error(), "[redacted]") {
		t.Fatalf("expected response snippet to be redacted, got %q", err.Error())
	}
}

func TestDeploymentTextBoundsLongErrors(t *testing.T) {
	text := deploymentText(DeploymentEvent{
		ApplicationName: "api",
		ServerName:      "prod",
		Status:          "failed",
		Error:           strings.Repeat("x", maxNotificationFieldLength+100),
	})

	if len(text) > maxNotificationTextLength {
		t.Fatalf("expected bounded notification text, got %d bytes", len(text))
	}
	if !strings.Contains(text, "...") {
		t.Fatalf("expected truncation marker, got %q", text)
	}
	if strings.Contains(text, strings.Repeat("x", maxNotificationFieldLength+1)) {
		t.Fatal("expected long error field to be truncated")
	}
}

func TestNotificationFieldTrimsWhitespace(t *testing.T) {
	if got := notificationField(" api "); got != "api" {
		t.Fatalf("expected trimmed field, got %q", got)
	}
}

func TestNotificationFieldRedactsSecretLookingValues(t *testing.T) {
	for _, value := range []string{
		"clone failed with ghp_1234567890abcdef",
		"slack returned xoxb-1234567890-secret",
		"request failed: Bearer abcdefghijklmnop",
		"-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----",
	} {
		t.Run(value, func(t *testing.T) {
			got := notificationField(value)
			if !strings.Contains(got, "[redacted]") {
				t.Fatalf("expected redaction marker, got %q", got)
			}
			if strings.Contains(got, "1234567890") || strings.Contains(got, "abcdefghijklmnop") || strings.Contains(got, "PRIVATE KEY") {
				t.Fatalf("expected secret-looking value to be removed, got %q", got)
			}
		})
	}
}

func TestDeploymentTextRedactsFailureSecrets(t *testing.T) {
	text := deploymentText(DeploymentEvent{
		ApplicationName: "api",
		ServerName:      "prod",
		Status:          "failed",
		Error:           "remote output included github_pat_1234567890abcdef",
	})

	if strings.Contains(text, "github_pat_1234567890abcdef") || !strings.Contains(text, "[redacted]") {
		t.Fatalf("expected failure secret to be redacted, got %q", text)
	}
}

func TestDeploymentSubjectBoundsApplicationName(t *testing.T) {
	subject := deploymentSubject(DeploymentEvent{
		Status:          "failed",
		ApplicationName: strings.Repeat("a", maxNotificationFieldLength+100),
	})

	if len(subject) > len("Deployment failed: ")+maxNotificationFieldLength {
		t.Fatalf("expected bounded subject, got %d bytes", len(subject))
	}
	if !strings.Contains(subject, "...") {
		t.Fatalf("expected truncated subject, got %q", subject)
	}
}

func TestResponseBodySnippetIsBounded(t *testing.T) {
	got := responseBodySnippet(strings.NewReader(strings.Repeat("x", 600)))
	if len(got) != 512 {
		t.Fatalf("expected bounded snippet, got %d bytes", len(got))
	}
}
