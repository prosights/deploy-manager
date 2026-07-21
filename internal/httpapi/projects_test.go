package httpapi

import (
	"errors"
	"strings"
	"testing"

	"deploy-manager/internal/db"

	"github.com/jackc/pgx/v5"
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

func TestEnvironmentDeletionErrorRejectsNonemptyEnvironment(t *testing.T) {
	err := environmentDeletionError(pgx.ErrNoRows)
	var validation validationError
	if !errors.As(err, &validation) || err.Error() != "remove all services before deleting the environment" {
		t.Fatalf("expected a clear non-empty environment error, got %v", err)
	}
}

func TestNormalizeProjectRuntimeVariablesSortsAndPreservesValues(t *testing.T) {
	variables, err := normalizeProjectRuntimeVariables([]projectRuntimeVariableInput{
		{Key: " PUBLIC_URL ", Value: " https://app.example.com/path "},
		{Key: "NODE_ENV", Value: "production"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(variables) != 2 || variables[0].Key != "NODE_ENV" || variables[1].Key != "PUBLIC_URL" {
		t.Fatalf("expected variables sorted by normalized key, got %+v", variables)
	}
	if variables[1].Value != " https://app.example.com/path " {
		t.Fatalf("expected value whitespace to be preserved, got %q", variables[1].Value)
	}
}

func TestNormalizeProjectRuntimeVariablesRejectsSecretsAndReservedKeys(t *testing.T) {
	tests := []struct {
		name      string
		variables []projectRuntimeVariableInput
	}{
		{name: "secret key", variables: []projectRuntimeVariableInput{{Key: "DATABASE_PASSWORD", Value: "value"}}},
		{name: "secret material", variables: []projectRuntimeVariableInput{{Key: "PUBLIC_VALUE", Value: "ghp_example"}}},
		{name: "database credential URL", variables: []projectRuntimeVariableInput{{Key: "PUBLIC_VALUE", Value: "postgres://app:password@db.example.com/app"}}},
		{name: "redis credential URL", variables: []projectRuntimeVariableInput{{Key: "PUBLIC_VALUE", Value: "redis://:password@redis.example.com:6379/0"}}},
		{name: "authorization header", variables: []projectRuntimeVariableInput{{Key: "PUBLIC_VALUE", Value: "Bearer secret-token"}}},
		{name: "embedded password", variables: []projectRuntimeVariableInput{{Key: "PUBLIC_VALUE", Value: "host=db.example.com password=secret"}}},
		{name: "deploy key", variables: []projectRuntimeVariableInput{{Key: "DEPLOY_COLOR", Value: "green"}}},
		{name: "image tag key", variables: []projectRuntimeVariableInput{{Key: "FINOPS_IMAGE_TAG", Value: "latest"}}},
		{name: "control character", variables: []projectRuntimeVariableInput{{Key: "PUBLIC_URL", Value: "one\ntwo"}}},
		{name: "duplicate normalized key", variables: []projectRuntimeVariableInput{{Key: "PUBLIC_URL", Value: "one"}, {Key: " PUBLIC_URL ", Value: "two"}}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := normalizeProjectRuntimeVariables(test.variables); err == nil {
				t.Fatal("expected project runtime variables to be rejected")
			}
		})
	}
}

func TestNormalizeProjectRuntimeVariablesRejectsOversizedEnvironment(t *testing.T) {
	variables := make([]projectRuntimeVariableInput, 9)
	for index := range variables {
		variables[index] = projectRuntimeVariableInput{
			Key:   "PUBLIC_VALUE_" + string(rune('A'+index)),
			Value: strings.Repeat("x", maxProjectRuntimeVariableValue),
		}
	}
	if _, err := normalizeProjectRuntimeVariables(variables); err == nil {
		t.Fatal("expected oversized rendered environment to be rejected")
	}
}

func TestProjectRuntimeVariablesEqualOnlyWhenContentMatches(t *testing.T) {
	existing := []db.ProjectRuntimeVariable{
		{Key: "NODE_ENV", Value: "production"},
		{Key: "PUBLIC_URL", Value: "https://app.example.com"},
	}
	requested := []projectRuntimeVariableInput{
		{Key: "NODE_ENV", Value: "production"},
		{Key: "PUBLIC_URL", Value: "https://app.example.com"},
	}
	if !projectRuntimeVariablesEqual(existing, requested) {
		t.Fatal("expected identical variables to avoid a configuration revision bump")
	}
	requested[1].Value = "https://new.example.com"
	if projectRuntimeVariablesEqual(existing, requested) {
		t.Fatal("expected changed variable value to require a configuration revision bump")
	}
}
