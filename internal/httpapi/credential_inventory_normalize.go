package httpapi

import (
	"encoding/json"
	"net/url"
	"strings"

	"deploy-manager/internal/connectors"
	"deploy-manager/internal/objectstorage"
)

var allowedCredentialProviders = map[string]struct{}{
	"github":  {},
	"doppler": {},
	"s3":      {},
	"gcs":     {},
	"slack":   {},
	"resend":  {},
	"ssh":     {},
}

const maxCredentialInventoryBatchSize = 500

func normalizeCredentialInventoryItem(item credentialInventoryItem) (credentialInventoryItem, error) {
	item.Name = strings.TrimSpace(item.Name)
	item.Provider = strings.ToLower(strings.TrimSpace(item.Provider))
	item.ExternalRef = strings.TrimSpace(item.ExternalRef)
	item.CredentialType = strings.TrimSpace(item.CredentialType)
	item.Status = strings.TrimSpace(item.Status)
	if item.Status == "" {
		item.Status = "active"
	}
	if !validCredentialStatus(item.Status) {
		return credentialInventoryItem{}, validationError("credential status must be active, rotating, revoked, or unknown")
	}
	if item.Name == "" || item.Provider == "" || item.ExternalRef == "" || item.CredentialType == "" {
		return credentialInventoryItem{}, validationError("name, provider, external_ref, and credential_type are required")
	}
	if hasControlCharacters(item.Name, item.ExternalRef, item.CredentialType) {
		return credentialInventoryItem{}, validationError("credential identity fields cannot contain control characters")
	}
	if looksLikeSecretMaterial(item.ExternalRef) {
		return credentialInventoryItem{}, validationError("credential external_ref must be a reference, not a secret value")
	}
	if _, ok := allowedCredentialProviders[item.Provider]; !ok {
		return credentialInventoryItem{}, validationError("credential provider must be github, doppler, s3, gcs, slack, resend, or ssh")
	}

	permissions, err := normalizeCredentialPermissions(item.Permissions)
	if err != nil {
		return credentialInventoryItem{}, err
	}
	usages, err := normalizeCredentialUsages(item.Usages)
	if err != nil {
		return credentialInventoryItem{}, err
	}

	item.Permissions = permissions
	item.Usages = usages
	return item, nil
}

func normalizeCredentialInventoryInput(input credentialInventoryInput) (credentialInventoryInput, error) {
	if len(input.Credentials) == 0 {
		return credentialInventoryInput{}, validationError("credentials are required")
	}
	if len(input.Credentials) > maxCredentialInventoryBatchSize {
		return credentialInventoryInput{}, validationError("credential inventory batch cannot exceed 500 credentials")
	}

	credentials := make([]credentialInventoryItem, 0, len(input.Credentials))
	for _, item := range input.Credentials {
		normalized, err := normalizeCredentialInventoryItem(item)
		if err != nil {
			return credentialInventoryInput{}, err
		}
		credentials = append(credentials, normalized)
	}
	input.Credentials = mergeCredentialInventoryItems(credentials)
	return input, nil
}

func credentialInventoryFromObjectStorage(buckets []objectstorage.BucketInventory) ([]credentialInventoryItem, error) {
	if len(buckets) > maxCredentialInventoryBatchSize {
		return nil, validationError("object storage inventory batch cannot exceed 500 buckets")
	}

	credentials := make([]credentialInventoryItem, 0, len(buckets))
	for _, bucket := range buckets {
		inventory, err := objectstorage.ToCredentialInventory(bucket)
		if err != nil {
			return nil, validationError(err.Error())
		}
		item, err := normalizeCredentialInventoryItem(credentialInventoryItem{
			Name:           inventory.Name,
			Provider:       inventory.Provider,
			ExternalRef:    inventory.ExternalRef,
			CredentialType: inventory.Type,
			Status:         inventory.Status,
			Permissions:    credentialPermissionsFromConnector(inventory.Permissions),
			Usages:         credentialUsagesFromConnector(inventory.Usages),
		})
		if err != nil {
			return nil, err
		}
		credentials = append(credentials, item)
	}
	return mergeCredentialInventoryItems(credentials), nil
}

func mergeCredentialInventoryItems(items []credentialInventoryItem) []credentialInventoryItem {
	merged := make([]credentialInventoryItem, 0, len(items))
	indexByRef := map[string]int{}

	for _, item := range items {
		key := credentialInventoryKey(item)
		index, ok := indexByRef[key]
		if !ok {
			indexByRef[key] = len(merged)
			merged = append(merged, item)
			continue
		}

		existing := merged[index]
		existing.Permissions = append(existing.Permissions, item.Permissions...)
		existing.Usages = append(existing.Usages, item.Usages...)
		existing.Permissions, _ = normalizeCredentialPermissions(existing.Permissions)
		existing.Usages, _ = normalizeCredentialUsages(existing.Usages)
		existing.Status = mergedCredentialStatus(existing.Status, item.Status)
		merged[index] = existing
	}

	return merged
}

func credentialInventoryKey(item credentialInventoryItem) string {
	return strings.Join([]string{item.Provider, item.ExternalRef}, "\x00")
}

func mergedCredentialStatus(left string, right string) string {
	if credentialStatusPriority(right) > credentialStatusPriority(left) {
		return right
	}
	return left
}

func credentialStatusPriority(status string) int {
	switch status {
	case "revoked":
		return 4
	case "rotating":
		return 3
	case "unknown":
		return 2
	case "active":
		return 1
	default:
		return 0
	}
}

func normalizeCredentialPermissions(values []credentialPermissionInput) ([]credentialPermissionInput, error) {
	permissions := make([]credentialPermissionInput, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		value.ResourceType = strings.TrimSpace(value.ResourceType)
		value.ResourceName = strings.TrimSpace(value.ResourceName)
		value.Permission = strings.TrimSpace(value.Permission)
		value.Source = strings.TrimSpace(value.Source)
		if value.Source == "" {
			value.Source = "connector"
		}
		if value.ResourceType == "" || value.ResourceName == "" || value.Permission == "" {
			return nil, validationError("permission resource_type, resource_name, and permission are required")
		}
		if hasControlCharacters(value.ResourceType, value.ResourceName, value.Permission, value.Source) {
			return nil, validationError("permission fields cannot contain control characters")
		}
		key := strings.Join([]string{value.ResourceType, value.ResourceName, value.Permission}, "\x00")
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		permissions = append(permissions, value)
	}
	return permissions, nil
}

func normalizeCredentialUsages(values []credentialUsageInput) ([]credentialUsageInput, error) {
	usages := make([]credentialUsageInput, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		value.UsedByType = strings.TrimSpace(value.UsedByType)
		value.UsedByName = strings.TrimSpace(value.UsedByName)
		value.UsageContext = strings.TrimSpace(value.UsageContext)
		if value.UsedByType == "" || value.UsedByName == "" || value.UsageContext == "" {
			return nil, validationError("usage used_by_type, used_by_name, and usage_context are required")
		}
		if hasControlCharacters(value.UsedByType, value.UsedByName, value.UsageContext) {
			return nil, validationError("usage fields cannot contain control characters")
		}
		key := strings.Join([]string{value.UsedByType, value.UsedByName, value.UsageContext}, "\x00")
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		usages = append(usages, value)
	}
	return usages, nil
}

func credentialPermissionsFromConnector(values []connectors.CredentialPermission) []credentialPermissionInput {
	permissions := make([]credentialPermissionInput, 0, len(values))
	for _, value := range values {
		permissions = append(permissions, credentialPermissionInput{
			ResourceType: value.ResourceType,
			ResourceName: value.ResourceName,
			Permission:   value.Permission,
			Source:       value.Source,
		})
	}
	return permissions
}

func credentialUsagesFromConnector(values []connectors.CredentialUsage) []credentialUsageInput {
	usages := make([]credentialUsageInput, 0, len(values))
	for _, value := range values {
		usages = append(usages, credentialUsageInput{
			UsedByType:   value.UsedByType,
			UsedByName:   value.UsedByName,
			UsageContext: value.UsageContext,
		})
	}
	return usages
}

func inventoryProviderCounts(providers []string) map[string]int {
	counts := map[string]int{}
	for _, provider := range providers {
		provider = strings.ToLower(strings.TrimSpace(provider))
		if provider == "" {
			continue
		}
		counts[provider]++
	}
	return counts
}

func validCredentialStatus(status string) bool {
	_, ok := connectors.NormalizeCredentialStatus(status)
	return ok
}

func hasControlCharacters(values ...string) bool {
	for _, value := range values {
		if strings.ContainsAny(value, "\r\n\t") {
			return true
		}
	}
	return false
}

func looksLikeSecretMaterial(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}
	upper := strings.ToUpper(value)
	for _, marker := range []string{
		"-----BEGIN",
		"PRIVATE KEY",
		"BEGIN OPENSSH PRIVATE KEY",
		"BEGIN RSA PRIVATE KEY",
	} {
		if strings.Contains(upper, marker) {
			return true
		}
	}

	lower := strings.ToLower(value)
	for _, prefix := range []string{"ghp_", "github_pat_", "xoxb-", "xoxp-", "sk_live_", "sk_test_", "dp.pt.", "aiza"} {
		if strings.HasPrefix(lower, prefix) {
			return true
		}
	}
	if strings.HasPrefix(upper, "AKIA") || strings.HasPrefix(upper, "ASIA") {
		return len(value) == 20
	}
	if strings.HasPrefix(lower, "https://hooks.slack.com/services/") {
		return true
	}
	if strings.HasPrefix(lower, "bearer ") || strings.HasPrefix(lower, "basic ") {
		return true
	}
	for _, marker := range []string{"password=", "passwd=", "pwd=", "token=", "secret=", "api_key=", "apikey=", "client_secret=", "access_key="} {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	if parsed, err := url.Parse(value); err == nil && parsed.Scheme != "" && parsed.Host != "" && parsed.User != nil {
		return true
	}
	return looksLikeCredentialJSON(value)
}

func looksLikeCredentialJSON(value string) bool {
	if !strings.HasPrefix(value, "{") {
		return false
	}

	var fields map[string]any
	if err := json.Unmarshal([]byte(value), &fields); err != nil {
		return false
	}
	for _, key := range []string{"private_key", "private_key_id", "client_secret", "access_token", "refresh_token"} {
		if _, ok := fields[key]; ok {
			return true
		}
	}
	return false
}
