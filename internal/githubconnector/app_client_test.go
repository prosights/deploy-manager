package githubconnector

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAppClientListsInstallationRepositories(t *testing.T) {
	privateKey := testPrivateKeyPEM(t)
	var sawJWT bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/app/installations/123/access_tokens":
			if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
				t.Fatalf("expected jwt bearer authorization")
			}
			sawJWT = true
			_, _ = w.Write([]byte(`{"token":"installation-token"}`))
		case "/installation/repositories":
			if r.Header.Get("Authorization") != "Bearer installation-token" {
				t.Fatalf("expected installation token, got %q", r.Header.Get("Authorization"))
			}
			_, _ = w.Write([]byte(`{"repositories":[{"id":42,"full_name":"prosights/recreate","default_branch":"main","clone_url":"https://github.com/prosights/recreate.git","html_url":"https://github.com/prosights/recreate"}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client, err := NewAppClient("99", privateKey, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	client.baseURL = server.URL
	repositories, err := client.ListInstallationRepositories(context.Background(), "123")
	if err != nil {
		t.Fatal(err)
	}
	if !sawJWT {
		t.Fatal("expected installation token request")
	}
	if len(repositories) != 1 || repositories[0].FullName != "prosights/recreate" || repositories[0].ID != 42 {
		t.Fatalf("unexpected repositories: %+v", repositories)
	}
}

func TestAppClientRejectsInvalidInstallationID(t *testing.T) {
	client, err := NewAppClient("99", testPrivateKeyPEM(t), nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.ListInstallationRepositories(context.Background(), "abc"); err == nil {
		t.Fatal("expected invalid installation id to fail")
	}
}

func TestAppClientCreatesRepositoryScopedInstallationToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/app/installations/123/access_tokens" {
			http.NotFound(w, r)
			return
		}
		var body struct {
			RepositoryIDs []int64           `json:"repository_ids"`
			Permissions   map[string]string `json:"permissions"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if len(body.RepositoryIDs) != 1 || body.RepositoryIDs[0] != 42 || body.Permissions["contents"] != "read" {
			t.Fatalf("expected repository-scoped read token request, got %+v", body)
		}
		_, _ = w.Write([]byte(`{"token":"installation-token"}`))
	}))
	defer server.Close()

	client, err := NewAppClient("99", testPrivateKeyPEM(t), server.Client())
	if err != nil {
		t.Fatal(err)
	}
	client.baseURL = server.URL
	token, err := client.InstallationToken(context.Background(), "123", "42")
	if err != nil {
		t.Fatal(err)
	}
	if token != "installation-token" {
		t.Fatalf("unexpected installation token %q", token)
	}
}

func TestAppClientIncludesGitHubErrorResponse(t *testing.T) {
	response := &http.Response{
		Status:     "422 Unprocessable Entity",
		StatusCode: http.StatusUnprocessableEntity,
		Body:       io.NopCloser(strings.NewReader(`{"message":"Unexpected inputs provided"}`)),
	}

	err := decodeGitHubResponse(response, nil)
	if err == nil || !strings.Contains(err.Error(), "Unexpected inputs provided") {
		t.Fatalf("expected GitHub error response, got %v", err)
	}
}

func TestAppClientDispatchesWorkflow(t *testing.T) {
	privateKey := testPrivateKeyPEM(t)
	var sawDispatch bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/app/installations/123/access_tokens":
			_, _ = w.Write([]byte(`{"token":"installation-token"}`))
		case "/repos/prosights/recreate/actions/workflows/build.yml/dispatches":
			if r.Header.Get("Authorization") != "Bearer installation-token" {
				t.Fatalf("expected installation token, got %q", r.Header.Get("Authorization"))
			}
			if r.ContentLength <= 0 || len(r.TransferEncoding) != 0 {
				t.Fatalf("expected fixed-length request body, got length %d and transfer encoding %v", r.ContentLength, r.TransferEncoding)
			}
			var body struct {
				Ref    string            `json:"ref"`
				Inputs map[string]string `json:"inputs"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body.Ref != "main" || body.Inputs["image"] != "us-docker.pkg.dev/proj/repo/app:sha" {
				t.Fatalf("unexpected dispatch body: %+v", body)
			}
			sawDispatch = true
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client, err := NewAppClient("99", privateKey, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	client.baseURL = server.URL
	err = client.DispatchWorkflow(context.Background(), "123", "prosights/recreate", "build.yml", "main", map[string]string{
		"image": "us-docker.pkg.dev/proj/repo/app:sha",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !sawDispatch {
		t.Fatal("expected workflow dispatch request")
	}
}

func TestAppClientGetsRepositoryFile(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/app/installations/123/access_tokens":
			_, _ = w.Write([]byte(`{"token":"installation-token"}`))
		case "/repos/prosights/internal/contents/apps/api/compose.yml":
			if r.URL.Query().Get("ref") != "main" {
				t.Fatalf("expected main ref, got %q", r.URL.Query().Get("ref"))
			}
			content := base64.StdEncoding.EncodeToString([]byte("services:\n  api:\n    image: api\n"))
			_, _ = w.Write([]byte(`{"type":"file","encoding":"base64","content":"` + content + `"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client, err := NewAppClient("99", testPrivateKeyPEM(t), server.Client())
	if err != nil {
		t.Fatal(err)
	}
	client.baseURL = server.URL
	content, err := client.GetRepositoryFile(context.Background(), "123", "prosights/internal", "apps/api/compose.yml", "main")
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "services:\n  api:\n    image: api\n" {
		t.Fatalf("unexpected file content %q", content)
	}
}

func TestAppClientGetsRepositoryCommitMetadata(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/app/installations/123/access_tokens":
			_, _ = w.Write([]byte(`{"token":"installation-token"}`))
		case "/repos/prosights/internal/commits/3e3405ae20", "/repos/prosights/internal/commits/main":
			if r.Header.Get("Authorization") != "Bearer installation-token" {
				t.Fatalf("expected installation token, got %q", r.Header.Get("Authorization"))
			}
			_, _ = w.Write([]byte(`{"sha":"3e3405ae20","html_url":"https://github.com/prosights/internal/commit/3e3405ae20","commit":{"message":"Ship deployment metadata\n\nDetails","author":{"name":"Pramit Bhatia"}},"author":{"login":"pramit","avatar_url":"https://avatars.githubusercontent.com/u/42?v=4"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client, err := NewAppClient("99", testPrivateKeyPEM(t), server.Client())
	if err != nil {
		t.Fatal(err)
	}
	client.baseURL = server.URL
	commit, err := client.GetRepositoryCommit(context.Background(), "123", "prosights/internal", "3e3405ae20")
	if err != nil {
		t.Fatal(err)
	}
	if commit.Message != "Ship deployment metadata" || commit.AuthorName != "Pramit Bhatia" || commit.AuthorLogin != "pramit" {
		t.Fatalf("unexpected commit metadata: %+v", commit)
	}
	if commit.AuthorAvatarURL != "https://avatars.githubusercontent.com/u/42?v=4" {
		t.Fatalf("unexpected commit avatar: %+v", commit)
	}
	if _, err := client.GetRepositoryCommit(context.Background(), "123", "prosights/internal", "main"); err != nil {
		t.Fatalf("get commit by branch: %v", err)
	}
}

func testPrivateKeyPEM(t *testing.T) string {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 1024)
	if err != nil {
		t.Fatal(err)
	}
	return string(pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(key),
	}))
}
