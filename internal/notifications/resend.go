package notifications

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type Resend struct {
	APIKey      string
	From        string
	To          string
	APIEndpoint string
	HTTPClient  *http.Client
}

func (r Resend) NotifyDeployment(ctx context.Context, event DeploymentEvent) error {
	apiKey := strings.TrimSpace(r.APIKey)
	from := strings.TrimSpace(r.From)
	to := strings.TrimSpace(r.To)
	if apiKey == "" || from == "" || to == "" {
		return nil
	}

	endpoint := strings.TrimSpace(r.APIEndpoint)
	if endpoint == "" {
		endpoint = "https://api.resend.com/emails"
	}
	payload := map[string]any{
		"from":    from,
		"to":      []string{to},
		"subject": deploymentSubject(event),
		"text":    deploymentText(event),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+apiKey)
	request.Header.Set("Content-Type", "application/json")

	return doJSON(r.client(), request)
}

func (r Resend) client() *http.Client {
	if r.HTTPClient != nil {
		return r.HTTPClient
	}
	return &http.Client{Timeout: 5 * time.Second}
}

func deploymentSubject(event DeploymentEvent) string {
	return fmt.Sprintf("Deployment %s: %s", notificationField(event.Status), notificationField(event.ApplicationName))
}
