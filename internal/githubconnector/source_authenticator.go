package githubconnector

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/url"
	"strings"

	"deploy-manager/internal/db"

	"github.com/jackc/pgx/v5/pgtype"
)

type connectorAccountSource interface {
	GetConnectorAccount(context.Context, pgtype.UUID) (db.ConnectorAccount, error)
}

// SourceAuthenticator resolves short-lived GitHub App credentials for source
// repositories without storing the token in Deploy Manager or on the target.
type SourceAuthenticator struct {
	accounts connectorAccountSource
	app      *AppClient
}

func NewSourceAuthenticator(accounts connectorAccountSource, app *AppClient) *SourceAuthenticator {
	return &SourceAuthenticator{accounts: accounts, app: app}
}

func (a *SourceAuthenticator) AuthorizationHeader(ctx context.Context, connectorID pgtype.UUID, sourceURL string) (string, error) {
	repository, ok := httpsGitHubRepository(sourceURL)
	if !connectorID.Valid || !ok || a == nil || a.accounts == nil || a.app == nil {
		return "", nil
	}

	account, err := a.accounts.GetConnectorAccount(ctx, connectorID)
	if err != nil {
		return "", fmt.Errorf("load github connector: %w", err)
	}
	if !account.Enabled || !strings.EqualFold(account.Provider, "github") {
		return "", nil
	}
	cfg, err := ParseConfig(account.Config)
	if err != nil {
		return "", fmt.Errorf("parse enabled github connector %q: %w", account.Name, err)
	}
	for _, configured := range cfg.Repositories {
		if !strings.EqualFold(configured.Repository, repository) || configured.InstallationID == "" || configured.RepositoryID == "" {
			continue
		}
		token, err := a.app.InstallationToken(ctx, configured.InstallationID, configured.RepositoryID)
		if err != nil {
			return "", fmt.Errorf("create github installation token: %w", err)
		}
		credentials := base64.StdEncoding.EncodeToString([]byte("x-access-token:" + token))
		return "Authorization: Basic " + credentials, nil
	}
	return "", nil
}

func httpsGitHubRepository(sourceURL string) (string, bool) {
	parsed, err := url.Parse(strings.TrimSpace(sourceURL))
	if err != nil || parsed.Scheme != "https" || !strings.EqualFold(parsed.Host, "github.com") || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", false
	}
	repository := strings.TrimSuffix(strings.Trim(parsed.Path, "/"), ".git")
	if !validRepository(repository) {
		return "", false
	}
	return repository, true
}
