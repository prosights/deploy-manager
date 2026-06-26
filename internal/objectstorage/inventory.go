package objectstorage

import (
	"fmt"
	"strings"

	"deploy-manager/internal/connectors"
)

type BucketInventory struct {
	Provider       string   `json:"provider"`
	CredentialName string   `json:"credential_name"`
	ExternalRef    string   `json:"external_ref"`
	CredentialType string   `json:"credential_type"`
	Status         string   `json:"status"`
	Bucket         string   `json:"bucket"`
	Permissions    []string `json:"permissions"`
	Usages         []Usage  `json:"usages"`
}

type Usage struct {
	UsedByType   string `json:"used_by_type"`
	UsedByName   string `json:"used_by_name"`
	UsageContext string `json:"usage_context"`
}

func ToCredentialInventory(input BucketInventory) (connectors.CredentialInventory, error) {
	input.Provider = normalizeProvider(input.Provider)
	input.CredentialName = strings.TrimSpace(input.CredentialName)
	input.ExternalRef = strings.TrimSpace(input.ExternalRef)
	input.CredentialType = strings.TrimSpace(input.CredentialType)
	input.Bucket = strings.TrimSpace(input.Bucket)

	status, ok := connectors.NormalizeCredentialStatus(input.Status)
	if !ok {
		return connectors.CredentialInventory{}, fmt.Errorf("credential status must be active, rotating, revoked, or unknown")
	}
	input.Status = status
	if input.CredentialType == "" {
		input.CredentialType = "service_account"
	}
	if input.Provider != "s3" && input.Provider != "gcs" {
		return connectors.CredentialInventory{}, fmt.Errorf("provider must be s3 or gcs")
	}
	if input.CredentialName == "" || input.ExternalRef == "" || input.Bucket == "" {
		return connectors.CredentialInventory{}, fmt.Errorf("credential_name, external_ref, and bucket are required")
	}

	permissions := make([]connectors.CredentialPermission, 0, len(input.Permissions))
	for _, permission := range input.Permissions {
		permission = strings.TrimSpace(permission)
		if permission == "" {
			continue
		}
		permissions = append(permissions, connectors.CredentialPermission{
			ResourceType: "bucket",
			ResourceName: bucketResourceName(input.Provider, input.Bucket),
			Permission:   permission,
			Source:       input.Provider,
		})
	}

	usages := make([]connectors.CredentialUsage, 0, len(input.Usages))
	for _, usage := range input.Usages {
		if strings.TrimSpace(usage.UsedByType) == "" || strings.TrimSpace(usage.UsedByName) == "" || strings.TrimSpace(usage.UsageContext) == "" {
			continue
		}
		usages = append(usages, connectors.CredentialUsage{
			UsedByType:   strings.TrimSpace(usage.UsedByType),
			UsedByName:   strings.TrimSpace(usage.UsedByName),
			UsageContext: strings.TrimSpace(usage.UsageContext),
		})
	}
	if len(usages) == 0 {
		usages = append(usages, connectors.CredentialUsage{
			UsedByType:   "bucket",
			UsedByName:   bucketResourceName(input.Provider, input.Bucket),
			UsageContext: "object storage access",
		})
	}

	return connectors.CredentialInventory{
		Name:        input.CredentialName,
		Provider:    input.Provider,
		ExternalRef: input.ExternalRef,
		Type:        input.CredentialType,
		Status:      input.Status,
		Permissions: permissions,
		Usages:      usages,
	}, nil
}

func normalizeProvider(provider string) string {
	return strings.ToLower(strings.TrimSpace(provider))
}

func bucketResourceName(provider string, bucket string) string {
	if provider == "gcs" {
		return "gs://" + bucket
	}
	return provider + "://" + bucket
}
