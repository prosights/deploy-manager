package httpapi

import (
	"encoding/json"
	"strings"

	"deploy-manager/internal/auditlog"
	"deploy-manager/internal/db"
)

var allowedConnectorProviders = map[string]struct{}{
	"github":  {},
	"doppler": {},
	"s3":      {},
	"gcs":     {},
	"slack":   {},
	"resend":  {},
}

func normalizeConnectorAccount(input db.UpsertConnectorAccountParams) (db.UpsertConnectorAccountParams, error) {
	input.Provider = strings.ToLower(strings.TrimSpace(input.Provider))
	input.Name = strings.TrimSpace(input.Name)
	if input.Provider == "" || input.Name == "" {
		return db.UpsertConnectorAccountParams{}, validationError("provider and name are required")
	}
	if hasControlCharacters(input.Name) {
		return db.UpsertConnectorAccountParams{}, validationError("connector name cannot contain control characters")
	}
	if _, ok := allowedConnectorProviders[input.Provider]; !ok {
		return db.UpsertConnectorAccountParams{}, validationError("unsupported connector provider")
	}

	config, err := normalizeConnectorConfig(input.Config)
	if err != nil {
		return db.UpsertConnectorAccountParams{}, err
	}
	input.Config = config

	return input, nil
}

func normalizeConnectorConfig(raw []byte) ([]byte, error) {
	if len(strings.TrimSpace(string(raw))) == 0 {
		return []byte("{}"), nil
	}

	var config map[string]any
	if err := json.Unmarshal(raw, &config); err != nil {
		return nil, validationError("connector config must be a JSON object")
	}
	if config == nil {
		return nil, validationError("connector config must be a JSON object")
	}
	if hasSecretConfigKey(config) {
		return nil, validationError("connector config cannot contain secret values; use environment variables or source systems")
	}
	if hasSecretConfigValue(config) {
		return nil, validationError("connector config cannot contain raw secret material; use environment variables or source systems")
	}
	config = pruneConnectorConfig(config)

	normalized, err := json.Marshal(config)
	if err != nil {
		return nil, err
	}
	return normalized, nil
}

func pruneConnectorConfig(value map[string]any) map[string]any {
	pruned := make(map[string]any, len(value))
	for key, child := range value {
		child, ok := pruneConnectorValue(child)
		if !ok {
			continue
		}
		pruned[key] = child
	}
	return pruned
}

func pruneConnectorValue(value any) (any, bool) {
	switch typed := value.(type) {
	case nil:
		return nil, false
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return nil, false
		}
		return trimmed, true
	case map[string]any:
		pruned := pruneConnectorConfig(typed)
		return pruned, len(pruned) > 0
	case []any:
		pruned := make([]any, 0, len(typed))
		for _, item := range typed {
			item, ok := pruneConnectorValue(item)
			if ok {
				pruned = append(pruned, item)
			}
		}
		return pruned, len(pruned) > 0
	default:
		return value, true
	}
}

func hasSecretConfigKey(value any) bool {
	values, ok := value.(map[string]any)
	if !ok {
		items, ok := value.([]any)
		if !ok {
			return false
		}
		for _, item := range items {
			if hasSecretConfigKey(item) {
				return true
			}
		}
		return false
	}

	for key, value := range values {
		if isSecretConfigKey(key) {
			return true
		}
		if hasSecretConfigKey(value) {
			return true
		}
	}
	return false
}

func isSecretConfigKey(key string) bool {
	return auditlog.IsSecretKey(key)
}

func hasSecretConfigValue(value any) bool {
	switch typed := value.(type) {
	case map[string]any:
		for _, child := range typed {
			if hasSecretConfigValue(child) {
				return true
			}
		}
	case []any:
		for _, child := range typed {
			if hasSecretConfigValue(child) {
				return true
			}
		}
	case string:
		return looksLikeSecretMaterial(typed)
	}
	return false
}
