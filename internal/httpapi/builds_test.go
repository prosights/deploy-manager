package httpapi

import (
	"testing"

	"deploy-manager/internal/db"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestNormalizeCompleteBuildRunRequiresImageForSucceededBuild(t *testing.T) {
	_, err := normalizeCompleteBuildRun(pgtype.UUID{Valid: true}, completeBuildRunRequest{Status: "succeeded"})
	if err == nil {
		t.Fatal("expected succeeded build without image_ref to fail")
	}
}

func TestNormalizeCompleteBuildRunAllowsFailedBuildWithoutImage(t *testing.T) {
	input, err := normalizeCompleteBuildRun(pgtype.UUID{Valid: true}, completeBuildRunRequest{
		Status:       "failed",
		ErrorMessage: "docker build failed",
	})
	if err != nil {
		t.Fatal(err)
	}
	if input.Status != "failed" || input.ImageRef.Valid || input.ErrorMessage.String != "docker build failed" {
		t.Fatalf("unexpected complete build input: %+v", input)
	}
}

func TestNormalizeCompleteBuildRunAcceptsImageRefAndDigest(t *testing.T) {
	input, err := normalizeCompleteBuildRun(pgtype.UUID{Valid: true}, completeBuildRunRequest{
		Status:      "succeeded",
		ImageRef:    "us-docker.pkg.dev/proj/repo/app:sha-123",
		ImageDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		ExternalURL: "https://github.com/prosights/recreate/actions/runs/123",
	})
	if err != nil {
		t.Fatal(err)
	}
	if input.Status != "succeeded" || input.ImageRef.String != "us-docker.pkg.dev/proj/repo/app:sha-123" || !input.ImageDigest.Valid {
		t.Fatalf("unexpected complete build input: %+v", input)
	}
}

func TestBuildCompleteDeploymentInputQueuesBlueGreenImageDeploy(t *testing.T) {
	appID := pgtype.UUID{Bytes: [16]byte{9, 8, 7}, Valid: true}
	buildID := pgtype.UUID{Bytes: [16]byte{1, 2, 3}, Valid: true}

	input, err := buildCompleteDeploymentInput(db.ListApplicationsForBuildCompleteRow{ID: appID}, db.BuildRun{
		ID:          buildID,
		CommitSha:   blankStringAsText("abc1234"),
		ImageRef:    blankStringAsText("us-docker.pkg.dev/proj/repo/app:abc1234"),
		ImageDigest: blankStringAsText("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if input.ApplicationID != appID || input.Trigger != "connector_sync" || input.Strategy != "blue_green" {
		t.Fatalf("unexpected deployment input: %+v", input)
	}
	if input.ImageRef.String != "us-docker.pkg.dev/proj/repo/app:abc1234" || input.CommitSha.String != "abc1234" {
		t.Fatalf("expected build artifact fields to carry through, got %+v", input)
	}
	if input.Actor.String != "build:01020300-0000-0000-0000-000000000000" {
		t.Fatalf("expected build actor, got %+v", input.Actor)
	}
}
