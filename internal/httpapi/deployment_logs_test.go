package httpapi

import (
	"errors"
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5"
)

func TestSetSSEHeadersDisablesBuffering(t *testing.T) {
	header := http.Header{}

	setSSEHeaders(header)

	if got := header.Get("Content-Type"); got != "text/event-stream" {
		t.Fatalf("expected SSE content type, got %q", got)
	}
	if got := header.Get("Cache-Control"); got != "no-cache, no-transform" {
		t.Fatalf("expected no-transform cache control, got %q", got)
	}
	if got := header.Get("X-Accel-Buffering"); got != "no" {
		t.Fatalf("expected proxy buffering disabled, got %q", got)
	}
	if got := header.Get("Connection"); got != "keep-alive" {
		t.Fatalf("expected keep-alive connection, got %q", got)
	}
}

func TestParseLastEventID(t *testing.T) {
	tests := []struct {
		value string
		want  int64
	}{
		{value: "42", want: 42},
		{value: "", want: 0},
		{value: "not-a-number", want: 0},
		{value: "-1", want: 0},
	}

	for _, test := range tests {
		t.Run(test.value, func(t *testing.T) {
			if got := parseLastEventID(test.value); got != test.want {
				t.Fatalf("expected %d, got %d", test.want, got)
			}
		})
	}
}

func TestSSEIDSkipsTransientEvents(t *testing.T) {
	if got := sseID(0); got != "" {
		t.Fatalf("expected blank id for transient event, got %q", got)
	}
	if got := sseID(42); got != "42" {
		t.Fatalf("expected id 42, got %q", got)
	}
}

func TestAdvanceLastEventIDSuppressesAlreadySentEvents(t *testing.T) {
	shouldSend, lastID := advanceLastEventID(40, 41)
	if !shouldSend || lastID != 41 {
		t.Fatalf("expected event 41 to send and advance cursor, got send=%v last=%d", shouldSend, lastID)
	}

	shouldSend, lastID = advanceLastEventID(lastID, 41)
	if shouldSend || lastID != 41 {
		t.Fatalf("expected duplicate event 41 to be skipped, got send=%v last=%d", shouldSend, lastID)
	}

	shouldSend, lastID = advanceLastEventID(lastID, 42)
	if !shouldSend || lastID != 42 {
		t.Fatalf("expected event 42 to send and advance cursor, got send=%v last=%d", shouldSend, lastID)
	}
}

func TestAdvanceLastEventIDAlwaysSendsTransientEvents(t *testing.T) {
	shouldSend, lastID := advanceLastEventID(42, 0)
	if !shouldSend || lastID != 42 {
		t.Fatalf("expected transient event to send without advancing cursor, got send=%v last=%d", shouldSend, lastID)
	}
}

func TestDeploymentLookupErrorMapsMissingDeploymentToNotFound(t *testing.T) {
	err := deploymentLookupError(pgx.ErrNoRows)

	var notFound notFoundError
	if !errors.As(err, &notFound) {
		t.Fatalf("expected not found error, got %T", err)
	}
}

func TestDeploymentLookupErrorKeepsUnexpectedErrors(t *testing.T) {
	cause := errors.New("database unavailable")

	if err := deploymentLookupError(cause); !errors.Is(err, cause) {
		t.Fatalf("expected original error, got %v", err)
	}
}
