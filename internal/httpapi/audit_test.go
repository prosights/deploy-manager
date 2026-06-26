package httpapi

import (
	"net/http"
	"strings"
	"testing"

	"deploy-manager/internal/auditlog"
)

func TestAuditActorUsesTrimmedDeployActorHeader(t *testing.T) {
	request := &http.Request{Header: http.Header{}, RemoteAddr: "10.0.0.5:1234"}
	request.Header.Set("X-Deploy-Actor", " ali ")

	if actor := auditActor(request); actor != "ali" {
		t.Fatalf("expected deploy actor, got %q", actor)
	}
}

func TestAuditActorRemovesControlCharacters(t *testing.T) {
	request := &http.Request{Header: http.Header{}, RemoteAddr: "10.0.0.5:1234"}
	request.Header.Set("X-Deploy-Actor", " ali\nroot\t ")

	if actor := auditActor(request); actor != "aliroot" {
		t.Fatalf("expected sanitized deploy actor, got %q", actor)
	}
}

func TestAuditActorUsesRemoteHostWithoutPort(t *testing.T) {
	request := &http.Request{Header: http.Header{}, RemoteAddr: "10.0.0.5:1234"}

	if actor := auditActor(request); actor != "10.0.0.5" {
		t.Fatalf("expected remote host, got %q", actor)
	}
}

func TestAuditActorIsBounded(t *testing.T) {
	request := &http.Request{Header: http.Header{}}
	request.Header.Set("X-Deploy-Actor", strings.Repeat("x", 200))

	if actor := auditActor(request); len(actor) != auditlog.MaxIdentityLength {
		t.Fatalf("expected bounded actor length, got %d", len(actor))
	}
}

func TestAuditIdentityFieldTrimsBoundsAndFallsBack(t *testing.T) {
	if got := auditIdentityField(" deployment.queue ", "unknown"); got != "deployment.queue" {
		t.Fatalf("expected trimmed identity field, got %q", got)
	}
	if got := auditIdentityField(" ", "unknown"); got != "unknown" {
		t.Fatalf("expected fallback identity field, got %q", got)
	}
	if got := auditIdentityField(strings.Repeat("x", auditlog.MaxIdentityLength+10), "unknown"); len(got) != auditlog.MaxIdentityLength {
		t.Fatalf("expected bounded identity field, got %d", len(got))
	}
}

func TestAuditEventLimitDefaultsAndClamps(t *testing.T) {
	tests := []struct {
		value string
		want  int32
	}{
		{value: "", want: defaultAuditEventLimit},
		{value: " 250 ", want: 250},
		{value: "9999", want: maxAuditEventLimit},
	}

	for _, test := range tests {
		t.Run(test.value, func(t *testing.T) {
			got, err := auditEventLimit(test.value)
			if err != nil {
				t.Fatal(err)
			}
			if got != test.want {
				t.Fatalf("expected limit %d, got %d", test.want, got)
			}
		})
	}
}

func TestAuditEventLimitRejectsInvalidValues(t *testing.T) {
	for _, value := range []string{"0", "-1", "all"} {
		t.Run(value, func(t *testing.T) {
			if _, err := auditEventLimit(value); err == nil {
				t.Fatal("expected invalid audit event limit to fail")
			}
		})
	}
}
