package sshutil

import (
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/crypto/ssh"
)

func TestExpandPathExpandsHomeDirectory(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}

	got := expandPath("~/.ssh/id_ed25519")
	want := filepath.Join(home, ".ssh/id_ed25519")
	if got != want {
		t.Fatalf("expected %s, got %s", want, got)
	}
}

func TestNewClientUsesProvidedHostKeyCallback(t *testing.T) {
	called := false
	callback := func(string, net.Addr, ssh.PublicKey) error {
		called = true
		return nil
	}

	client := NewClientWithOptions("example.com", 22, "deploy", nil, ClientOptions{HostKeyCallback: callback})
	if err := client.hostKeyCallback("", nil, nil); err != nil {
		t.Fatal(err)
	}
	if !called {
		t.Fatal("expected provided host key callback to be used")
	}
}

func TestKnownHostsCallbackRejectsWhenKnownHostsCannotLoad(t *testing.T) {
	callback := knownHostsCallback(filepath.Join(t.TempDir(), "missing_known_hosts"))

	err := callback("example.com:22", nil, nil)
	if err == nil {
		t.Fatal("expected missing known_hosts file to fail closed")
	}
	if !strings.Contains(err.Error(), "known_hosts") {
		t.Fatalf("expected known_hosts error, got %q", err.Error())
	}
}

func TestDefaultKnownHostsPathCanBeOverridden(t *testing.T) {
	path := filepath.Join(t.TempDir(), "known_hosts")
	t.Setenv("SSH_KNOWN_HOSTS_PATH", " "+path+" ")

	if got := defaultKnownHostsPath(); got != path {
		t.Fatalf("expected override known_hosts path %q, got %q", path, got)
	}
}

func TestDefaultKnownHostsPathFallsBackToHome(t *testing.T) {
	t.Setenv("SSH_KNOWN_HOSTS_PATH", " ")

	if got := defaultKnownHostsPath(); !strings.HasSuffix(got, filepath.Join(".ssh", "known_hosts")) {
		t.Fatalf("expected default known_hosts path, got %q", got)
	}
}

func TestParseHealthMetrics(t *testing.T) {
	result, err := parseHealthMetrics("CPU 12.50\nMEMORY 64.25\nDISK 88.00\n")
	if err != nil {
		t.Fatal(err)
	}

	if result.CPUUsage != 12.50 || result.MemoryUsage != 64.25 || result.DiskUsage != 88.00 {
		t.Fatalf("unexpected metrics: %+v", result)
	}
}

func TestParseHealthMetricsRequiresAllMetrics(t *testing.T) {
	_, err := parseHealthMetrics("CPU 12.50\nMEMORY 64.25\n")
	if err == nil {
		t.Fatal("expected missing disk metric to fail")
	}
}

func TestParseHealthMetricsClampsPercentages(t *testing.T) {
	result, err := parseHealthMetrics("CPU -1\nMEMORY 101\nDISK 50\n")
	if err != nil {
		t.Fatal(err)
	}
	if result.CPUUsage != 0 || result.MemoryUsage != 100 {
		t.Fatalf("expected clamped metrics, got %+v", result)
	}
}

func TestParseHealthMetricsRejectsNonFinitePercentages(t *testing.T) {
	_, err := parseHealthMetrics("CPU NaN\nMEMORY 50\nDISK 50\n")
	if err == nil {
		t.Fatal("expected non-finite metric to fail")
	}
}

func TestHealthStatusReflectsResourcePressure(t *testing.T) {
	tests := []struct {
		name   string
		result HealthResult
		want   string
	}{
		{
			name:   "healthy",
			result: HealthResult{CPUUsage: 20, MemoryUsage: 50, DiskUsage: 60},
			want:   "healthy",
		},
		{
			name:   "high cpu",
			result: HealthResult{CPUUsage: 95, MemoryUsage: 50, DiskUsage: 60},
			want:   "degraded",
		},
		{
			name:   "high memory",
			result: HealthResult{CPUUsage: 20, MemoryUsage: 90, DiskUsage: 60},
			want:   "degraded",
		},
		{
			name:   "high disk",
			result: HealthResult{CPUUsage: 20, MemoryUsage: 50, DiskUsage: 90},
			want:   "degraded",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := healthStatus(test.result); got != test.want {
				t.Fatalf("expected %s, got %s", test.want, got)
			}
		})
	}
}
