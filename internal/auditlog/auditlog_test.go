package auditlog

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestIdentityFieldTrimsBoundsAndFallsBack(t *testing.T) {
	if got := IdentityField(" deployment.queue ", "unknown"); got != "deployment.queue" {
		t.Fatalf("expected trimmed identity field, got %q", got)
	}
	if got := IdentityField(" ", "unknown"); got != "unknown" {
		t.Fatalf("expected fallback identity field, got %q", got)
	}
	if got := IdentityField(strings.Repeat("x", MaxIdentityLength+10), "unknown"); len(got) != MaxIdentityLength {
		t.Fatalf("expected bounded identity field, got %d", len(got))
	}
}

func TestIdentityFieldRemovesControlCharacters(t *testing.T) {
	if got := IdentityField(" deploy\n.queue\t ", "unknown"); got != "deploy.queue" {
		t.Fatalf("expected control characters removed, got %q", got)
	}
	if got := IdentityField("\n\t", "unknown"); got != "unknown" {
		t.Fatalf("expected fallback after removing controls, got %q", got)
	}
}

func TestMetadataRedactsSecretLikeKeys(t *testing.T) {
	data := Metadata(map[string]any{
		"provider": "github",
		"apiToken": "secret",
		"nested": map[string]any{
			"client_secret": "secret",
		},
	})

	var metadata map[string]any
	if err := json.Unmarshal(data, &metadata); err != nil {
		t.Fatal(err)
	}
	if metadata["provider"] != "github" || metadata["apiToken"] != "[redacted]" {
		t.Fatalf("unexpected sanitized metadata: %+v", metadata)
	}
	nested := metadata["nested"].(map[string]any)
	if nested["client_secret"] != "[redacted]" {
		t.Fatalf("expected nested secret to be redacted, got %+v", nested)
	}
}

func TestMetadataRedactsSecretLookingValues(t *testing.T) {
	data := Metadata(map[string]any{
		"error":   "clone failed with ghp_1234567890abcdef",
		"message": "request failed: Bearer abcdefghijklmnop",
		"nested": map[string]any{
			"output": "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----",
		},
	})

	var metadata map[string]any
	if err := json.Unmarshal(data, &metadata); err != nil {
		t.Fatal(err)
	}
	encoded := string(data)
	for _, leaked := range []string{"ghp_1234567890abcdef", "abcdefghijklmnop", "PRIVATE KEY"} {
		if strings.Contains(encoded, leaked) {
			t.Fatalf("expected secret-looking value %q to be redacted, got %s", leaked, encoded)
		}
	}
	if !strings.Contains(metadata["error"].(string), "[redacted]") || !strings.Contains(metadata["message"].(string), "Bearer [redacted]") {
		t.Fatalf("expected redaction markers, got %+v", metadata)
	}
}

func TestStringFieldRemovesControlCharactersAndRedactsSecrets(t *testing.T) {
	got := StringField(" failed\nwith Bearer abcdefghijklmnop\t")

	if strings.ContainsAny(got, "\r\n\t") {
		t.Fatalf("expected control characters removed, got %q", got)
	}
	if strings.Contains(got, "abcdefghijklmnop") || !strings.Contains(got, "Bearer [redacted]") {
		t.Fatalf("expected bearer token redacted, got %q", got)
	}
}

func TestStringFieldBoundsLongValues(t *testing.T) {
	got := StringField(strings.Repeat("x", MaxStringLength+10))

	if len(got) != MaxStringLength {
		t.Fatalf("expected bounded string field, got %d", len(got))
	}
}

func TestMetadataBoundsLongStrings(t *testing.T) {
	data := Metadata(map[string]any{"message": strings.Repeat("x", MaxStringLength+10)})

	var metadata map[string]string
	if err := json.Unmarshal(data, &metadata); err != nil {
		t.Fatal(err)
	}
	if len(metadata["message"]) != MaxStringLength {
		t.Fatalf("expected bounded metadata string, got %d", len(metadata["message"]))
	}
}

func TestMetadataFallsBackWhenOversized(t *testing.T) {
	metadata := map[string]any{}
	for index := 0; index < 10; index++ {
		metadata[string(rune('a'+index))] = strings.Repeat("x", MaxStringLength)
	}

	data := Metadata(metadata)

	if string(data) != `{"truncated":true}` {
		t.Fatalf("expected truncated metadata marker, got %s", data)
	}
}
