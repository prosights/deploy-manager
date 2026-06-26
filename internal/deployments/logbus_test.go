package deployments

import (
	"context"
	"testing"
	"time"

	"deploy-manager/internal/db"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestLogBusDeliversOnlyMatchingDeploymentEvents(t *testing.T) {
	bus := NewLogBus()
	deploymentID := "deployment-1"
	otherID := "deployment-2"
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	events := bus.Subscribe(ctx, deploymentID)
	bus.Publish(ctx, LogEvent{DeploymentID: otherID, Stream: "stdout", Message: "ignore"})
	bus.Publish(ctx, LogEvent{DeploymentID: deploymentID, Stream: "stdout", Message: "deliver"})

	select {
	case event := <-events:
		if event.Message != "deliver" {
			t.Fatalf("expected matching event, got %q", event.Message)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for matching event")
	}
}

func TestShouldDeliverLogEventRequiresMatchingDeploymentID(t *testing.T) {
	if !shouldDeliverLogEvent("deployment-1", LogEvent{DeploymentID: "deployment-1"}) {
		t.Fatal("expected matching deployment event to deliver")
	}
	if shouldDeliverLogEvent("deployment-1", LogEvent{DeploymentID: "deployment-2"}) {
		t.Fatal("expected mismatched deployment event to be dropped")
	}
}

func TestDeploymentLogEventKeepsPersistentFields(t *testing.T) {
	deploymentID, err := pgUUID("018f3a2b-8a55-7c5f-90c5-11bbf0eb42b2")
	if err != nil {
		t.Fatal(err)
	}
	createdAt := pgtype.Timestamptz{Time: time.Unix(1700000000, 0), Valid: true}

	event := deploymentLogEvent(db.DeploymentLog{
		ID:           42,
		DeploymentID: deploymentID,
		Stream:       "system",
		Message:      "deploying",
		CreatedAt:    createdAt,
	})

	if event.ID != 42 || event.DeploymentID != "018f3a2b-8a55-7c5f-90c5-11bbf0eb42b2" || event.CreatedAt.Time != createdAt.Time {
		t.Fatalf("expected persistent fields on event, got %+v", event)
	}
}
