package notifications

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"deploy-manager/internal/stringutil"
)

const (
	maxNotificationFieldLength = 1000
	maxNotificationTextLength  = 4000
)

type DeploymentEvent struct {
	DeploymentID    string
	ApplicationName string
	ServerName      string
	Status          string
	Trigger         string
	CommitSHA       string
	Error           string
}

type Notifier interface {
	NotifyDeployment(context.Context, DeploymentEvent) error
}

type Noop struct{}

func (Noop) NotifyDeployment(context.Context, DeploymentEvent) error {
	return nil
}

type Multi []Notifier

func (m Multi) NotifyDeployment(ctx context.Context, event DeploymentEvent) error {
	var errs []error
	for _, notifier := range m {
		if notifier == nil {
			continue
		}
		if err := notifier.NotifyDeployment(ctx, event); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

func deploymentText(event DeploymentEvent) string {
	parts := []string{
		fmt.Sprintf("Deployment %s for %s on %s", event.Status, notificationField(event.ApplicationName), notificationField(event.ServerName)),
	}
	if event.Trigger != "" {
		parts = append(parts, "trigger: "+notificationField(event.Trigger))
	}
	if event.CommitSHA != "" {
		parts = append(parts, "commit: "+notificationField(event.CommitSHA))
	}
	if event.DeploymentID != "" {
		parts = append(parts, "deployment: "+notificationField(event.DeploymentID))
	}
	if event.Error != "" {
		parts = append(parts, "error: "+notificationField(event.Error))
	}
	return truncateWithMarker(strings.Join(parts, "\n"), maxNotificationTextLength)
}

func notificationField(value string) string {
	value = strings.TrimSpace(value)
	value = stringutil.RedactSensitiveText(value)
	return truncateWithMarker(value, maxNotificationFieldLength)
}

func truncateWithMarker(value string, limit int) string {
	if limit <= 0 || len(value) <= limit {
		return value
	}
	const marker = "..."
	if limit <= len(marker) {
		return value[:limit]
	}
	return value[:limit-len(marker)] + marker
}

func doJSON(client *http.Client, request *http.Request) error {
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode > 299 {
		message := strings.TrimSpace(responseBodySnippet(response.Body))
		if message == "" {
			return fmt.Errorf("notification request failed with status %d", response.StatusCode)
		}
		return fmt.Errorf("notification request failed with status %d: %s", response.StatusCode, message)
	}
	return nil
}

func responseBodySnippet(body io.Reader) string {
	data, err := io.ReadAll(io.LimitReader(body, 512))
	if err != nil {
		return ""
	}
	return stringutil.RedactSensitiveText(string(data))
}
