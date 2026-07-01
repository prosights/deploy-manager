package sshutil

import (
	"context"
	"fmt"

	"golang.org/x/crypto/ssh"
)

// ServerRef carries the coordinates needed to obtain a signer and open a
// connection to a target server. It is intentionally decoupled from database
// types so signer backends do not depend on the persistence layer.
type ServerRef struct {
	Host    string
	Port    int32
	User    string
	KeyPath string
}

// SignerSource is the seam for obtaining an SSH signer. The rest of the
// codebase depends on this interface rather than on how a signer is produced,
// so the custody mechanism can change (static key file, CA-signed short-lived
// certificate, external agent) without touching call sites.
type SignerSource interface {
	Signer(ctx context.Context, server ServerRef) (ssh.Signer, error)
}

// FileSigner reads a static private key from the filesystem path recorded for
// the server. This reproduces the original behavior: Deploy Manager stores only
// the path (a reference), never the key bytes, and the key file is expected to
// be provisioned out-of-band (e.g. mounted by a secret system).
type FileSigner struct{}

func (FileSigner) Signer(_ context.Context, server ServerRef) (ssh.Signer, error) {
	if server.KeyPath == "" {
		return nil, fmt.Errorf("ssh key path is required")
	}
	return LoadSigner(server.KeyPath)
}
