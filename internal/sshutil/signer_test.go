package sshutil

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/pem"
	"errors"
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

func TestCASignerRequiresConfiguredCA(t *testing.T) {
	if _, err := (CASigner{}).Signer(context.Background(), ServerRef{User: "deploy"}); err == nil {
		t.Fatal("expected unconfigured CA to error")
	}
}

func TestCASignerRequiresPrincipal(t *testing.T) {
	signer := NewCASigner(stubCA{})
	if _, err := signer.Signer(context.Background(), ServerRef{}); err == nil {
		t.Fatal("expected missing principal to error")
	}
}

func TestCASignerMintsCertificate(t *testing.T) {
	signer := NewCASigner(stubCA{})
	result, err := signer.Signer(context.Background(), ServerRef{User: "deploy"})
	if err != nil {
		t.Fatalf("expected CA signer to mint a certificate, got %v", err)
	}
	if _, ok := result.PublicKey().(*ssh.Certificate); !ok {
		t.Fatalf("expected signer to present an ssh certificate, got %T", result.PublicKey())
	}
}

func TestCASignerPropagatesCAError(t *testing.T) {
	signer := NewCASigner(stubCA{err: errors.New("vault unavailable")})
	if _, err := signer.Signer(context.Background(), ServerRef{User: "deploy"}); err == nil {
		t.Fatal("expected CA error to propagate")
	}
}

// stubCA is an in-test certificate authority: it signs the presented ephemeral
// public key into a user certificate with a throwaway CA key.
type stubCA struct {
	err error
}

func (s stubCA) SignUserCertificate(_ context.Context, publicKey []byte, principal string) ([]byte, error) {
	if s.err != nil {
		return nil, s.err
	}
	pub, _, _, _, err := ssh.ParseAuthorizedKey(publicKey)
	if err != nil {
		return nil, err
	}
	_, caPriv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	caSigner, err := ssh.NewSignerFromKey(caPriv)
	if err != nil {
		return nil, err
	}
	cert := &ssh.Certificate{
		Key:             pub,
		CertType:        ssh.UserCert,
		ValidPrincipals: []string{principal},
		ValidBefore:     ssh.CertTimeInfinity,
	}
	if err := cert.SignCert(rand.Reader, caSigner); err != nil {
		return nil, err
	}
	return ssh.MarshalAuthorizedKey(cert), nil
}
