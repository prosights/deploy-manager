package notificationconnector

import (
	"context"
	"testing"

	"deploy-manager/internal/connectors"
)

func TestSlackSyncCredentialsReportsChannelAccess(t *testing.T) {
	inventory, err := New("slack").SyncCredentials(context.Background(), connectors.SyncScope{
		Name: "deployment alerts",
		Config: []byte(`{
			"credential_ref": "env:SLACK_WEBHOOK_URL",
			"channels": ["#deployments", "#infra"],
			"applications": ["api"]
		}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(inventory) != 1 {
		t.Fatalf("expected one credential inventory item, got %+v", inventory)
	}

	item := inventory[0]
	if item.Provider != "slack" || item.ExternalRef != "env:SLACK_WEBHOOK_URL" || item.Type != "incoming_webhook" {
		t.Fatalf("unexpected Slack inventory identity: %+v", item)
	}
	if len(item.Permissions) != 2 || item.Permissions[0].Permission != "chat:write" {
		t.Fatalf("unexpected Slack permissions: %+v", item.Permissions)
	}
	if len(item.Usages) != 1 || item.Usages[0].UsedByName != "api" {
		t.Fatalf("unexpected Slack usages: %+v", item.Usages)
	}
}

func TestSlackSyncCredentialsRequiresChannels(t *testing.T) {
	_, err := New("slack").SyncCredentials(context.Background(), connectors.SyncScope{
		Name:   "deployment alerts",
		Config: []byte(`{"applications":["api"]}`),
	})
	if err == nil {
		t.Fatal("expected missing Slack channels to fail")
	}
}

func TestSlackSyncCredentialsRejectsInvalidStatus(t *testing.T) {
	_, err := New("slack").SyncCredentials(context.Background(), connectors.SyncScope{
		Name: "deployment alerts",
		Config: []byte(`{
			"status": "disabled",
			"channels": ["#deployments"]
		}`),
	})
	if err == nil {
		t.Fatal("expected invalid Slack status to fail")
	}
}

func TestResendSyncCredentialsReportsSenderAccess(t *testing.T) {
	inventory, err := New("resend").SyncCredentials(context.Background(), connectors.SyncScope{
		Name: "deployment emails",
		Config: []byte(`{
			"credential_ref": "env:RESEND_API_KEY",
			"domains": ["deploy.example.com"],
			"senders": ["Deploy <deploy@example.com>"],
			"applications": ["api"]
		}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(inventory) != 1 {
		t.Fatalf("expected one credential inventory item, got %+v", inventory)
	}

	item := inventory[0]
	if item.Provider != "resend" || item.ExternalRef != "env:RESEND_API_KEY" || item.Type != "api_key" {
		t.Fatalf("unexpected Resend inventory identity: %+v", item)
	}
	if len(item.Permissions) != 2 || item.Permissions[0].Permission != "email:send" {
		t.Fatalf("unexpected Resend permissions: %+v", item.Permissions)
	}
	if len(item.Usages) != 1 || item.Usages[0].UsageContext != "send email deployment notifications" {
		t.Fatalf("unexpected Resend usages: %+v", item.Usages)
	}
}

func TestResendSyncCredentialsDefaultsUsage(t *testing.T) {
	inventory, err := New("resend").SyncCredentials(context.Background(), connectors.SyncScope{
		Config: []byte(`{"domains":["deploy.example.com"]}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(inventory[0].Usages) != 1 || inventory[0].Usages[0].UsedByType != "deployment" {
		t.Fatalf("expected default deployment usage, got %+v", inventory[0].Usages)
	}
}

func TestResendSyncCredentialsRequiresDomainsOrSenders(t *testing.T) {
	_, err := New("resend").SyncCredentials(context.Background(), connectors.SyncScope{
		Name:   "deployment emails",
		Config: []byte(`{"applications":["api"]}`),
	})
	if err == nil {
		t.Fatal("expected missing Resend sender metadata to fail")
	}
}

func TestResendSyncCredentialsRejectsInvalidStatus(t *testing.T) {
	_, err := New("resend").SyncCredentials(context.Background(), connectors.SyncScope{
		Name: "deployment emails",
		Config: []byte(`{
			"status": "disabled",
			"domains": ["deploy.example.com"]
		}`),
	})
	if err == nil {
		t.Fatal("expected invalid Resend status to fail")
	}
}

func TestSyncCredentialsRejectsUnsupportedProvider(t *testing.T) {
	_, err := New("pagerduty").SyncCredentials(context.Background(), connectors.SyncScope{Config: []byte(`{}`)})
	if err == nil {
		t.Fatal("expected unsupported provider to fail")
	}
}
