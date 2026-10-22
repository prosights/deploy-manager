package main

import (
	"testing"
	"time"
)

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
