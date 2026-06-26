package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

const maxJSONBodyBytes int64 = 2 << 20

func readJSON(w http.ResponseWriter, r *http.Request, target any) error {
	defer r.Body.Close()
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxJSONBodyBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		if isRequestBodyTooLarge(err) {
			return validationError("JSON request body must be 2 MiB or smaller")
		}
		return validationError("invalid JSON request body: " + err.Error())
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		if isRequestBodyTooLarge(err) {
			return validationError("JSON request body must be 2 MiB or smaller")
		}
		return validationError("invalid JSON request body: multiple JSON values are not allowed")
	}
	return nil
}

func isRequestBodyTooLarge(err error) bool {
	var maxBytesError *http.MaxBytesError
	return errors.As(err, &maxBytesError)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	var validation validationError
	if errors.As(err, &validation) {
		status = http.StatusBadRequest
	}
	var notFound notFoundError
	if errors.As(err, &notFound) {
		status = http.StatusNotFound
	}
	if isRequestBodyTooLarge(err) {
		status = http.StatusBadRequest
	}
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func writeSSE(w http.ResponseWriter, event string, payload any) {
	writeSSEWithID(w, "", event, payload)
}

func writeSSEWithID(w http.ResponseWriter, id string, event string, payload any) {
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	if strings.TrimSpace(id) != "" {
		_, _ = fmt.Fprintf(w, "id: %s\n", id)
	}
	_, _ = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, data)
}

func writeSSEComment(w http.ResponseWriter, comment string) {
	comment = strings.ReplaceAll(comment, "\n", " ")
	comment = strings.TrimSpace(comment)
	if comment == "" {
		comment = "keepalive"
	}
	_, _ = fmt.Fprintf(w, ": %s\n\n", comment)
}

type validationError string

func (e validationError) Error() string {
	return string(e)
}

type notFoundError string

func (e notFoundError) Error() string {
	return string(e)
}
