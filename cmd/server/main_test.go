package main

import (
	"testing"
	"time"

	"deploy-manager/internal/doppler"
)

type stubRuntimeProvider struct{ provider string }

func (s stubRuntimeProvider) Provider() string { return s.provider }

func TestRequireDopplerRuntimeSourceAcceptsDoppler(t *testing.T) {
	runtime := doppler.NewWithCommand("project", "config", "token", "doppler")
	if err := requireDopplerRuntimeSource(runtime); err != nil {
		t.Fatalf("expected doppler runtime source to be accepted, got %v", err)
	}
}

func TestRequireDopplerRuntimeSourceRejectsOtherProviders(t *testing.T) {
	if err := requireDopplerRuntimeSource(stubRuntimeProvider{provider: "vault"}); err == nil {
		t.Fatal("expected non-doppler runtime source to be rejected")
	}
}

func TestRequireDopplerRuntimeSourceRejectsSourceWithoutProvider(t *testing.T) {
	if err := requireDopplerRuntimeSource(struct{}{}); err == nil {
		t.Fatal("expected runtime source without Provider() to be rejected")
	}
}

func TestWaitForWorkerReturnsWhenWorkerStops(t *testing.T) {
	done := make(chan struct{})
	close(done)

	started := time.Now()
	waitForWorker(done, time.Second)

	if time.Since(started) > 100*time.Millisecond {
		t.Fatal("expected stopped worker to return immediately")
	}
}

func TestWaitForWorkerHonorsTimeout(t *testing.T) {
	done := make(chan struct{})
	started := time.Now()

	waitForWorker(done, 10*time.Millisecond)

	if time.Since(started) < 10*time.Millisecond {
		t.Fatal("expected worker wait to honor timeout")
	}
}
