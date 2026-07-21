package httpapi

import (
	"strings"
	"testing"

	"deploy-manager/internal/db"
)

func TestApplicationTerminalDirectory(t *testing.T) {
	tests := map[string]struct {
		application db.Application
		want        string
	}{
		"repository root": {
			application: db.Application{RemoteDirectory: "/srv/apps/api", ComposePath: "compose.yml"},
			want:        "/srv/apps/api",
		},
		"service folder": {
			application: db.Application{RemoteDirectory: "/srv/apps/internal", ComposePath: "alleyes-v2/compose.playground.yml"},
			want:        "/srv/apps/internal/alleyes-v2",
		},
	}

	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			if got := applicationTerminalDirectory(test.application); got != test.want {
				t.Fatalf("applicationTerminalDirectory() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestTerminalShellCommandStartsInDirectoryWhenAvailable(t *testing.T) {
	command := terminalShellCommand("/srv/deploy-manager", "/bin/sh", true)

	if !strings.Contains(command, "if [ -d '/srv/deploy-manager' ]; then cd '/srv/deploy-manager'; fi") {
		t.Fatalf("expected guarded cd, got %q", command)
	}
	if !strings.Contains(command, "exec ${SHELL:-/bin/sh} -i") {
		t.Fatalf("expected interactive shell, got %q", command)
	}
}
