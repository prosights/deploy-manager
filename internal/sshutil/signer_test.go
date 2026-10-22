package sshutil

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/pem"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/crypto/ssh"
)

func writeTestKey(t *testing.T) string {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	block, err := ssh.MarshalPrivateKey(priv, "")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "id_ed25519")
	if err := os.WriteFile(path, pem.EncodeToMemory(block), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestFileSignerLoadsKeyFromPath(t *testing.T) {
	path := writeTestKey(t)
	signer, err := FileSigner{}.Signer(context.Background(), ServerRef{KeyPath: path, User: "deploy"})
	if err != nil {
		t.Fatalf("expected file signer to load key, got %v", err)
	}
	if signer == nil {
		t.Fatal("expected a non-nil signer")
	}
}

func TestFileSignerRequiresKeyPath(t *testing.T) {
	if _, err := (FileSigner{}).Signer(context.Background(), ServerRef{}); err == nil {
		t.Fatal("expected missing key path to error")
	}
}
