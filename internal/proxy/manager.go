package proxy

import (
	"context"
	"fmt"
	"strings"
	"unicode"

	"deploy-manager/internal/db"
	"deploy-manager/internal/sshutil"

	"github.com/jackc/pgx/v5/pgtype"
)

const maxRemoteProxyOutputLength = 2048

type Manager struct {
	queries queries
}

type queries interface {
	GetProxyRouteTarget(context.Context, pgtype.UUID) (db.GetProxyRouteTargetRow, error)
	MarkProxyRouteApplied(context.Context, pgtype.UUID) (db.ProxyRoute, error)
	MarkProxyRouteFailed(context.Context, pgtype.UUID) (db.ProxyRoute, error)
}

func NewManager(queries queries) Manager {
	return Manager{queries: queries}
}

func (m Manager) Apply(ctx context.Context, id pgtype.UUID) (db.ProxyRoute, error) {
	target, err := m.queries.GetProxyRouteTarget(ctx, id)
	if err != nil {
		return db.ProxyRoute{}, err
	}
	if !target.SshKeyPath.Valid || strings.TrimSpace(target.SshKeyPath.String) == "" {
		return db.ProxyRoute{}, m.markFailed(ctx, id, fmt.Errorf("server ssh_key_path is required to apply proxy routes"))
	}

	command, err := BuildCommand(Target{
		Domain:     target.Domain,
		Upstream:   target.UpstreamUrl,
		TLSEnabled: target.TlsEnabled,
		ProxyType:  target.ProxyType,
	})
	if err != nil {
		return db.ProxyRoute{}, m.markFailed(ctx, id, err)
	}

	signer, err := sshutil.LoadSigner(target.SshKeyPath.String)
	if err != nil {
		return db.ProxyRoute{}, m.markFailed(ctx, id, err)
	}

	client := sshutil.NewClient(target.Hostname, target.SshPort, target.SshUser, signer)
	if output, err := client.Run(ctx, command); err != nil {
		cause := err
		output = remoteProxyOutput(output)
		if output == "" {
			return db.ProxyRoute{}, m.markFailed(ctx, id, cause)
		}
		return db.ProxyRoute{}, m.markFailed(ctx, id, fmt.Errorf("%w: %s", cause, output))
	}

	return m.queries.MarkProxyRouteApplied(ctx, id)
}

func (m Manager) markFailed(ctx context.Context, id pgtype.UUID, cause error) error {
	if _, err := m.queries.MarkProxyRouteFailed(ctx, id); err != nil {
		return fmt.Errorf("%w; mark proxy route failed: %v", cause, err)
	}
	return cause
}

func remoteProxyOutput(output string) string {
	output = strings.TrimSpace(output)
	if output == "" {
		return ""
	}
	output = strings.Map(func(char rune) rune {
		if unicode.IsControl(char) {
			return ' '
		}
		return char
	}, output)
	output = strings.Join(strings.Fields(output), " ")
	if len(output) <= maxRemoteProxyOutputLength {
		return output
	}
	return output[:maxRemoteProxyOutputLength] + "...[truncated]"
}
