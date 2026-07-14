package db

import (
	"strings"
	"testing"
)

func TestCompleteBuildRunDoesNotRepeatSuccessfulCompletion(t *testing.T) {
	if !strings.Contains(completeBuildRun, "AND status <> 'succeeded'") {
		t.Fatal("successful build completion must be idempotent")
	}
}
