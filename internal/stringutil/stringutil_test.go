package stringutil

import (
	"strings"
	"testing"
)

func TestRedactSensitiveTextRedactsGitAuthorizationHeader(t *testing.T) {
	redacted := RedactSensitiveText("git -c http.extraHeader='Authorization: Basic eC1hY2Nlc3MtdG9rZW46c2VjcmV0'")
	if strings.Contains(redacted, "eC1hY2Nlc3MtdG9rZW46c2VjcmV0") {
		t.Fatalf("expected git authorization header to be redacted, got %q", redacted)
	}
}
