package sshutil

import (
	"context"

	"deploy-manager/internal/db"

	"golang.org/x/crypto/ssh"
)

const ConnectionModeTailscaleSSH = "tailscale_ssh"

func ServerClient(ctx context.Context, server db.Server, signerSource SignerSource) (Client, error) {
	if server.ConnectionMode == ConnectionModeTailscaleSSH {
		return NewTailscaleSSHClient(server.Hostname, server.SshPort, server.SshUser), nil
	}
	signer, err := signerForServer(ctx, server, signerSource)
	if err != nil {
		return Client{}, err
	}
	return NewClient(server.Hostname, server.SshPort, server.SshUser, signer), nil
}

func signerForServer(ctx context.Context, server db.Server, signerSource SignerSource) (ssh.Signer, error) {
	if signerSource == nil {
		signerSource = FileSigner{}
	}
	return signerSource.Signer(ctx, ServerRef{
		Host:    server.Hostname,
		Port:    server.SshPort,
		User:    server.SshUser,
		KeyPath: server.SshKeyPath.String,
	})
}
