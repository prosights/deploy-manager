package sshutil

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"fmt"

	"golang.org/x/crypto/ssh"
)

// CertificateAuthority is the abstract boundary to an SSH certificate authority
// (e.g. HashiCorp Vault's SSH secrets engine, smallstep step-ca). Deploy Manager
// never holds the CA private key; it asks the CA to sign an ephemeral public key
// into a short-lived certificate.
//
// SignUserCertificate receives the marshaled authorized-keys form of an
// ephemeral public key and the principal (remote username) the certificate
// should authorize, and returns the marshaled authorized-keys form of the
// signed certificate.
type CertificateAuthority interface {
	SignUserCertificate(ctx context.Context, publicKey []byte, principal string) ([]byte, error)
}

// CASigner mints short-lived, CA-signed certificates for each connection. It
// generates a throwaway ed25519 keypair in memory, asks the CA to sign the
// public half scoped to the target user, and returns a signer that presents the
// ephemeral private key together with the certificate.
//
// Nothing long-lived is persisted: the ephemeral key lives only for the
// connection and the certificate expires per the CA's configured TTL. This is
// the scaffold for the SSH-CA custody model; it is inert until a concrete
// CertificateAuthority is wired in.
type CASigner struct {
	ca CertificateAuthority
}

func NewCASigner(ca CertificateAuthority) CASigner {
	return CASigner{ca: ca}
}

func (s CASigner) Signer(ctx context.Context, server ServerRef) (ssh.Signer, error) {
	if s.ca == nil {
		return nil, fmt.Errorf("ssh certificate authority is not configured")
	}
	if server.User == "" {
		return nil, fmt.Errorf("ssh user (certificate principal) is required")
	}

	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("generate ephemeral ssh key: %w", err)
	}
	ephemeralSigner, err := ssh.NewSignerFromKey(privateKey)
	if err != nil {
		return nil, fmt.Errorf("build ephemeral signer: %w", err)
	}

	signedBytes, err := s.ca.SignUserCertificate(ctx, ssh.MarshalAuthorizedKey(ephemeralSigner.PublicKey()), server.User)
	if err != nil {
		return nil, fmt.Errorf("sign ssh certificate: %w", err)
	}

	parsed, _, _, _, err := ssh.ParseAuthorizedKey(signedBytes)
	if err != nil {
		return nil, fmt.Errorf("parse signed ssh certificate: %w", err)
	}
	certificate, ok := parsed.(*ssh.Certificate)
	if !ok {
		return nil, fmt.Errorf("certificate authority did not return an ssh certificate")
	}

	certSigner, err := ssh.NewCertSigner(certificate, ephemeralSigner)
	if err != nil {
		return nil, fmt.Errorf("build certificate signer: %w", err)
	}
	return certSigner, nil
}
