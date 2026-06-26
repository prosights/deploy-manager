package httpapi

import (
	"testing"

	"deploy-manager/internal/db"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestNormalizeCreateProjectTrimsAndNormalizesSlug(t *testing.T) {
	input, err := normalizeCreateProject(db.CreateProjectWithDefaultEnvironmentsParams{
		Name:        " Billing ",
		Slug:        " Billing-API ",
		Description: " Internal app ",
	})
	if err != nil {
		t.Fatal(err)
	}
	if input.Name != "Billing" || input.Slug != "billing-api" || input.Description != "Internal app" {
		t.Fatalf("unexpected project normalization: %+v", input)
	}
}

func TestNormalizeCreateProjectRejectsUnsafeSlug(t *testing.T) {
	_, err := normalizeCreateProject(db.CreateProjectWithDefaultEnvironmentsParams{
		Name: "Billing",
		Slug: "billing_api",
	})
	if err == nil {
		t.Fatal("expected unsafe slug to fail")
	}
}

func TestNormalizeCreateEnvironmentConfiguresPreviewAsEphemeral(t *testing.T) {
	input, err := normalizeCreateEnvironment(db.CreateEnvironmentParams{
		ProjectID:         pgtype.UUID{Valid: true},
		Name:              " PR 42 ",
		Slug:              " PR-42 ",
		Kind:              "preview",
		PullRequestNumber: pgtype.Int4{Int32: 42, Valid: true},
		Branch:            pgtype.Text{String: " feature/billing ", Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !input.IsEphemeral || input.Slug != "pr-42" || input.Branch.String != "feature/billing" {
		t.Fatalf("expected preview environment normalization, got %+v", input)
	}
}

func TestNormalizeCreateEnvironmentRejectsInvalidPreviewPRNumber(t *testing.T) {
	_, err := normalizeCreateEnvironment(db.CreateEnvironmentParams{
		ProjectID:         pgtype.UUID{Valid: true},
		Name:              "PR",
		Slug:              "pr",
		Kind:              "preview",
		PullRequestNumber: pgtype.Int4{Int32: -1, Valid: true},
	})
	if err == nil {
		t.Fatal("expected invalid PR number to fail")
	}
}

func TestNormalizeCreateEnvironmentForcesStableEnvironmentsNonEphemeral(t *testing.T) {
	input, err := normalizeCreateEnvironment(db.CreateEnvironmentParams{
		ProjectID:         pgtype.UUID{Valid: true},
		Name:              "Production",
		Slug:              "production",
		Kind:              "production",
		IsEphemeral:       true,
		PullRequestNumber: pgtype.Int4{Int32: 42, Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if input.IsEphemeral || input.PullRequestNumber.Valid {
		t.Fatalf("expected stable environment to clear ephemeral fields, got %+v", input)
	}
}
