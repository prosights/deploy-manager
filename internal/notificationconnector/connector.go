package notificationconnector

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"deploy-manager/internal/connectors"
	"deploy-manager/internal/stringutil"
)

type Connector struct {
	provider string
}

type slackConfig struct {
	CredentialName string                       `json:"credential_name"`
	CredentialRef  string                       `json:"credential_ref"`
	Status         string                       `json:"status"`
	Channels       []string                     `json:"channels"`
	Applications   []string                     `json:"applications"`
	Usages         []connectors.CredentialUsage `json:"usages"`
}

type resendConfig struct {
	CredentialName string                       `json:"credential_name"`
	CredentialRef  string                       `json:"credential_ref"`
	Status         string                       `json:"status"`
	Domains        []string                     `json:"domains"`
	Senders        []string                     `json:"senders"`
	Applications   []string                     `json:"applications"`
	Usages         []connectors.CredentialUsage `json:"usages"`
}

func New(provider string) Connector {
	return Connector{provider: strings.ToLower(strings.TrimSpace(provider))}
}

func (c Connector) Provider() string {
	return c.provider
}

func (c Connector) SyncCredentials(_ context.Context, scope connectors.SyncScope) ([]connectors.CredentialInventory, error) {
	switch c.provider {
	case "slack":
		return syncSlack(scope)
	case "resend":
		return syncResend(scope)
	default:
		return nil, fmt.Errorf("provider must be slack or resend")
	}
}

func (c Connector) RuntimeVariables(context.Context, connectors.RuntimeVariableScope) ([]connectors.RuntimeVariable, error) {
	return nil, nil
}

func syncSlack(scope connectors.SyncScope) ([]connectors.CredentialInventory, error) {
	var cfg slackConfig
	if err := json.Unmarshal(scope.Config, &cfg); err != nil {
		return nil, fmt.Errorf("parse slack connector config: %w", err)
	}

	cfg.CredentialName = stringutil.FirstNonBlank(cfg.CredentialName, strings.TrimSpace(scope.Name), "Slack deployment notifications")
	cfg.CredentialRef = stringutil.FirstNonBlank(cfg.CredentialRef, "env:SLACK_WEBHOOK_URL")
	status, ok := connectors.NormalizeCredentialStatus(cfg.Status)
	if !ok {
		return nil, fmt.Errorf("credential status must be active, rotating, revoked, or unknown")
	}
	channels := stringutil.UniqueTrimmed(cfg.Channels)
	if len(channels) == 0 {
		return nil, fmt.Errorf("slack connector config requires channels")
	}

	permissions := make([]connectors.CredentialPermission, 0, len(channels))
	for _, channel := range channels {
		permissions = append(permissions, connectors.CredentialPermission{
			ResourceType: "slack_channel",
			ResourceName: channel,
			Permission:   "chat:write",
			Source:       "slack",
		})
	}

	return []connectors.CredentialInventory{{
		Name:        cfg.CredentialName,
		Provider:    "slack",
		ExternalRef: cfg.CredentialRef,
		Type:        "incoming_webhook",
		Status:      status,
		Permissions: permissions,
		Usages:      notificationUsages(cfg.Usages, cfg.Applications, "send Slack deployment notifications"),
	}}, nil
}

func syncResend(scope connectors.SyncScope) ([]connectors.CredentialInventory, error) {
	var cfg resendConfig
	if err := json.Unmarshal(scope.Config, &cfg); err != nil {
		return nil, fmt.Errorf("parse resend connector config: %w", err)
	}

	cfg.CredentialName = stringutil.FirstNonBlank(cfg.CredentialName, strings.TrimSpace(scope.Name), "Resend deployment notifications")
	cfg.CredentialRef = stringutil.FirstNonBlank(cfg.CredentialRef, "env:RESEND_API_KEY")
	status, ok := connectors.NormalizeCredentialStatus(cfg.Status)
	if !ok {
		return nil, fmt.Errorf("credential status must be active, rotating, revoked, or unknown")
	}
	resources := append(stringutil.UniqueTrimmed(cfg.Domains), stringutil.UniqueTrimmed(cfg.Senders)...)
	if len(resources) == 0 {
		return nil, fmt.Errorf("resend connector config requires domains or senders")
	}

	permissions := make([]connectors.CredentialPermission, 0, len(resources))
	for _, resource := range resources {
		permissions = append(permissions, connectors.CredentialPermission{
			ResourceType: "email_sender",
			ResourceName: resource,
			Permission:   "email:send",
			Source:       "resend",
		})
	}

	return []connectors.CredentialInventory{{
		Name:        cfg.CredentialName,
		Provider:    "resend",
		ExternalRef: cfg.CredentialRef,
		Type:        "api_key",
		Status:      status,
		Permissions: permissions,
		Usages:      notificationUsages(cfg.Usages, cfg.Applications, "send email deployment notifications"),
	}}, nil
}

func notificationUsages(explicit []connectors.CredentialUsage, applications []string, defaultContext string) []connectors.CredentialUsage {
	usages := make([]connectors.CredentialUsage, 0, len(explicit)+len(applications))
	for _, usage := range explicit {
		usage.UsedByType = strings.TrimSpace(usage.UsedByType)
		usage.UsedByName = strings.TrimSpace(usage.UsedByName)
		usage.UsageContext = strings.TrimSpace(usage.UsageContext)
		if usage.UsedByType == "" || usage.UsedByName == "" || usage.UsageContext == "" {
			continue
		}
		usages = append(usages, usage)
	}
	for _, application := range stringutil.UniqueTrimmed(applications) {
		usages = append(usages, connectors.CredentialUsage{
			UsedByType:   "application",
			UsedByName:   application,
			UsageContext: defaultContext,
		})
	}
	if len(usages) == 0 {
		usages = append(usages, connectors.CredentialUsage{
			UsedByType:   "deployment",
			UsedByName:   "all",
			UsageContext: defaultContext,
		})
	}
	return usages
}
