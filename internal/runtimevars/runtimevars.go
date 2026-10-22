// Package runtimevars holds the environment variables rendered into a
// deployment's .env file. Values come from Doppler or project settings.
package runtimevars

import "regexp"

type Variable struct {
	Key      string `json:"key"`
	Value    string `json:"-"`
	IsPublic bool   `json:"is_public"`
}

// Scope selects which Doppler project/config to read for an application.
type Scope struct {
	ApplicationName string
	Project         string
	Config          string
}

var keyPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

func ValidKey(key string) bool {
	return keyPattern.MatchString(key)
}
