package httpapi

import (
	"errors"
	"strings"
	"testing"
)

func TestNormalizeServerCommandTrimsSafeCommands(t *testing.T) {
	command, err := normalizeServerCommand(" docker compose ps ")
	if err != nil {
		t.Fatal(err)
	}
	if command != "docker compose ps" {
		t.Fatalf("expected trimmed command, got %q", command)
	}
}

func TestNormalizeServerCommandRejectsUnsafeInput(t *testing.T) {
	for _, command := range []string{
		"",
		"   ",
		"docker ps\nwhoami",
		"docker ps\t--all",
		strings.Repeat("a", maxServerCommandLength+1),
	} {
		t.Run(command, func(t *testing.T) {
			if _, err := normalizeServerCommand(command); err == nil {
				t.Fatal("expected command to fail validation")
			}
		})
	}
}

func TestServerCommandAuditMetadataDoesNotStoreCommandOrOutput(t *testing.T) {
	metadata := serverCommandAuditMetadata("token-value", errors.New("exit status 1"))

	if metadata["success"] != false || metadata["error"] != "exit status 1" || metadata["output_bytes"] != len("token-value") {
		t.Fatalf("unexpected command metadata: %+v", metadata)
	}
	if _, ok := metadata["command"]; ok {
		t.Fatalf("did not expect command text in audit metadata: %+v", metadata)
	}
	if _, ok := metadata["output"]; ok {
		t.Fatalf("did not expect output text in audit metadata: %+v", metadata)
	}
}
