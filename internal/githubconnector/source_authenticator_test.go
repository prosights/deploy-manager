package githubconnector

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"testing"

	"deploy-manager/internal/db"

	"github.com/jackc/pgx/v5/pgtype"
)

type fakeConnectorAccountSource struct {
	account db.ConnectorAccount
	calls   int
	id      pgtype.UUID
}

func (f *fakeConnectorAccountSource) GetConnectorAccount(_ context.Context, id pgtype.UUID) (db.ConnectorAccount, error) {
	f.calls++
	f.id = id
	return f.account, nil
}

func TestSourceAuthenticatorUsesMatchingEnabledGitHubApp(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.URL.Path != "/app/installations/123/access_tokens" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(`{"token":"installation-token"}`))
	}))
	defer server.Close()

	app, err := NewAppClient("99", testPrivateKeyPEM(t), server.Client())
	if err != nil {
		t.Fatal(err)
	}
	app.baseURL = server.URL
	accounts := &fakeConnectorAccountSource{account: db.ConnectorAccount{
		Provider: "github",
		Enabled:  true,
		Config:   []byte(`{"installation_id":"123","repositories":[{"repository":"prosights/internal","repository_id":"42","application_id":"018f3a2b-8a55-7c5f-90c5-11bbf0eb42b9"}]}`),
	}}
	authenticator := NewSourceAuthenticator(accounts, app)
	connectorID := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}

	header, err := authenticator.AuthorizationHeader(context.Background(), connectorID, "https://github.com/prosights/internal.git")
	if err != nil {
		t.Fatal(err)
	}
	want := "Authorization: Basic " + base64.StdEncoding.EncodeToString([]byte("x-access-token:installation-token"))
	if header != want || requests != 1 || accounts.id != connectorID {
		t.Fatalf("expected the selected connector and one short-lived GitHub App header, got header=%q requests=%d connector=%v", header, requests, accounts.id)
	}

	for _, sourceURL := range []string{"git@github.com:prosights/internal.git", "https://github.com/prosights/other.git"} {
		header, err = authenticator.AuthorizationHeader(context.Background(), connectorID, sourceURL)
		if err != nil {
			t.Fatal(err)
		}
		if header != "" || requests != 1 {
			t.Fatalf("expected %s to preserve unauthenticated behavior", sourceURL)
		}
	}

	header, err = authenticator.AuthorizationHeader(context.Background(), pgtype.UUID{}, "https://github.com/prosights/internal.git")
	if err != nil || header != "" || accounts.calls != 2 {
		t.Fatalf("expected a blank legacy connector id to skip auth, got header=%q err=%v calls=%d", header, err, accounts.calls)
	}

	accounts.account.Config = []byte(`{"repositories":[{"repository":"prosights/internal"}]}`)
	header, err = authenticator.AuthorizationHeader(context.Background(), connectorID, "https://github.com/prosights/internal.git")
	if err != nil || header != "" || requests != 1 || accounts.calls != 3 {
		t.Fatalf("expected blank legacy installation/repository ids to skip auth, got header=%q err=%v requests=%d calls=%d", header, err, requests, accounts.calls)
	}
}
