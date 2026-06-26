package notifications

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

type Slack struct {
	WebhookURL string
	HTTPClient *http.Client
}

func (s Slack) NotifyDeployment(ctx context.Context, event DeploymentEvent) error {
	webhookURL := strings.TrimSpace(s.WebhookURL)
	if webhookURL == "" {
		return nil
	}

	payload := map[string]string{"text": deploymentText(event)}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, webhookURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")

	return doJSON(s.client(), request)
}

func (s Slack) client() *http.Client {
	if s.HTTPClient != nil {
		return s.HTTPClient
	}
	return &http.Client{Timeout: 5 * time.Second}
}
