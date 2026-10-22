package httpapi

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
)

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := w.Header()
		header.Set("X-Content-Type-Options", "nosniff")
		header.Set("Referrer-Policy", "no-referrer")
		header.Set("X-Frame-Options", "DENY")
		header.Set("Content-Security-Policy", "frame-ancestors 'none'")
		next.ServeHTTP(w, r)
	})
}

func sameHostOrigin(origin string, host string) bool {
	origin = strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(origin, "http://"), "https://"))
	return strings.EqualFold(origin, host)
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
