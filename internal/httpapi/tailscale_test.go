package httpapi

import (
	"testing"
	"time"
)

func TestFirstTailscaleIPPrefersIPv4(t *testing.T) {
	got := firstTailscaleIP([]string{"fd7a:115c:a1e0::1", "100.64.0.10"})
	if got != "100.64.0.10" {
		t.Fatalf("expected IPv4 Tailscale IP, got %q", got)
	}
}

func TestFormatTailscaleTimeOmitsZeroValue(t *testing.T) {
	if got := formatTailscaleTime(time.Time{}); got != "" {
		t.Fatalf("expected empty zero timestamp, got %q", got)
	}
}
