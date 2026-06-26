package httpapi

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestReadJSONRejectsMalformedBodyAsValidationError(t *testing.T) {
	var input struct {
		Name string `json:"name"`
	}
	request := httptest.NewRequest(http.MethodPost, "/api/test", strings.NewReader(`{"name"`))
	response := httptest.NewRecorder()

	err := readJSON(response, request, &input)
	if err == nil {
		t.Fatal("expected malformed JSON to fail")
	}
	var validation validationError
	if !errors.As(err, &validation) {
		t.Fatalf("expected validation error, got %T", err)
	}
}

func TestReadJSONRejectsTrailingJSONValues(t *testing.T) {
	var input struct {
		Name string `json:"name"`
	}
	request := httptest.NewRequest(http.MethodPost, "/api/test", strings.NewReader(`{"name":"api"} {"name":"worker"}`))
	response := httptest.NewRecorder()

	err := readJSON(response, request, &input)
	if err == nil {
		t.Fatal("expected trailing JSON value to fail")
	}
}

func TestReadJSONRejectsOversizedBody(t *testing.T) {
	var input struct {
		Name string `json:"name"`
	}
	body := `{"name":"` + strings.Repeat("a", int(maxJSONBodyBytes)) + `"}`
	request := httptest.NewRequest(http.MethodPost, "/api/test", strings.NewReader(body))
	response := httptest.NewRecorder()

	err := readJSON(response, request, &input)
	if err == nil {
		t.Fatal("expected oversized JSON body to fail")
	}
	if !strings.Contains(err.Error(), "2 MiB") {
		t.Fatalf("expected body size error, got %q", err.Error())
	}
}

func TestWriteErrorReturnsBadRequestForInvalidJSON(t *testing.T) {
	var input struct {
		Name string `json:"name"`
	}
	request := httptest.NewRequest(http.MethodPost, "/api/test", strings.NewReader(`{"extra":"value"}`))
	response := httptest.NewRecorder()

	writeError(response, readJSON(response, request, &input))

	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", response.Code)
	}
}

func TestWriteErrorReturnsBadRequestForOversizedBody(t *testing.T) {
	response := httptest.NewRecorder()

	writeError(response, &http.MaxBytesError{Limit: maxJSONBodyBytes})

	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", response.Code)
	}
}

func TestWriteErrorReturnsNotFoundForMissingResource(t *testing.T) {
	response := httptest.NewRecorder()

	writeError(response, notFoundError("credential not found"))

	if response.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", response.Code)
	}
}

func TestWriteSSECommentSanitizesComment(t *testing.T) {
	response := httptest.NewRecorder()

	writeSSEComment(response, "keep\nalive")

	if got := response.Body.String(); got != ": keep alive\n\n" {
		t.Fatalf("unexpected SSE comment: %q", got)
	}
}
