package auditlog

import (
	"encoding/json"
	"strings"

	"deploy-manager/internal/stringutil"
)

const (
	MaxStringLength   = 512
	MaxMetadataLength = 4096
	MaxIdentityLength = 128
)

func IdentityField(value string, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	value = strings.Map(func(char rune) rune {
		switch char {
		case '\r', '\n', '\t':
			return -1
		default:
			return char
		}
	}, value)
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	if len(value) > MaxIdentityLength {
		return value[:MaxIdentityLength]
	}
	return value
}

func StringField(value string) string {
	value = strings.Map(func(char rune) rune {
		if char < 32 || char == 127 {
			return -1
		}
		return char
	}, strings.TrimSpace(value))
	value = stringutil.RedactSensitiveText(value)
	if len(value) > MaxStringLength {
		return value[:MaxStringLength]
	}
	return value
}

func Metadata(metadata map[string]any) []byte {
	if metadata == nil {
		return []byte("{}")
	}
	data, err := json.Marshal(sanitizeValue(metadata))
	if err != nil {
		return []byte("{}")
	}
	if len(data) > MaxMetadataLength {
		return []byte(`{"truncated":true}`)
	}
	return data
}

func sanitizeValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		return sanitizeMap(typed)
	case []any:
		values := make([]any, 0, len(typed))
		for _, item := range typed {
			values = append(values, sanitizeValue(item))
		}
		return values
	case string:
		return StringField(typed)
	default:
		return typed
	}
}

func sanitizeMap(values map[string]any) map[string]any {
	sanitized := make(map[string]any, len(values))
	for key, value := range values {
		if IsSecretKey(key) {
			sanitized[key] = "[redacted]"
			continue
		}
		sanitized[key] = sanitizeValue(value)
	}
	return sanitized
}

func IsSecretKey(key string) bool {
	normalized := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(key), "-", "_"))
	if normalized == "" {
		return false
	}
	compact := strings.ReplaceAll(normalized, "_", "")

	for _, part := range []string{"secret", "token", "password", "private_key", "api_key", "client_secret", "access_key", "access_key_id"} {
		compactPart := strings.ReplaceAll(part, "_", "")
		if strings.Contains(normalized, part) || strings.Contains(compact, compactPart) {
			return true
		}
	}
	return false
}
