package githubhook

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"reflect"
	"testing"
)

func TestParsePushBuildsRepositoryAliases(t *testing.T) {
	push, err := ParsePush([]byte(`{
		"ref":"refs/heads/main",
		"after":"abc123",
		"repository":{
			"full_name":"acme/app",
			"html_url":"https://github.com/acme/app",
			"clone_url":"https://github.com/acme/app.git",
			"ssh_url":"git@github.com:acme/app.git"
		},
		"sender":{"login":"ali"}
	}`))
	if err != nil {
		t.Fatal(err)
	}

	if push.Branch != "main" || push.CommitSHA != "abc123" || push.Actor != "ali" {
		t.Fatalf("unexpected push: %+v", push)
	}
	expected := []string{
		"git@github.com:acme/app.git",
		"https://github.com/acme/app",
		"https://github.com/acme/app.git",
	}
	if !reflect.DeepEqual(push.Repositories, expected) {
		t.Fatalf("expected supported repository aliases %+v, got %+v", expected, push.Repositories)
	}
}

func TestParsePushCollectsChangedPaths(t *testing.T) {
	push, err := ParsePush([]byte(`{
		"ref":"refs/heads/main",
		"after":"abc123",
		"repository":{"full_name":"acme/app"},
		"commits":[{
			"added":["portal/Dockerfile", " finops/api/main.go "],
			"modified":["portal/Dockerfile"],
			"removed":["alleyes/old.go", ""]
		}]
	}`))
	if err != nil {
		t.Fatal(err)
	}

	expected := []string{"portal/Dockerfile", "finops/api/main.go", "alleyes/old.go"}
	if !reflect.DeepEqual(push.ChangedPaths, expected) {
		t.Fatalf("expected changed paths %+v, got %+v", expected, push.ChangedPaths)
	}
}

func TestParsePushRejectsUnsupportedRepositoryAliases(t *testing.T) {
	_, err := ParsePush([]byte(`{
		"ref":"refs/heads/main",
		"after":"abc123",
		"repository":{
			"full_name":"acme/app/actions",
			"html_url":"https://gitlab.com/acme/app",
			"clone_url":"https://token@github.com/acme/app.git",
			"ssh_url":"ssh://github.com/acme/app.git"
		},
		"sender":{"login":"ali"}
	}`))
	if err == nil {
		t.Fatal("expected unsupported repository aliases to fail")
	}
}

func TestParsePushRejectsNonBranchRefs(t *testing.T) {
	_, err := ParsePush([]byte(`{
		"ref":"refs/tags/v1",
		"repository":{"full_name":"acme/app"}
	}`))
	if err == nil {
		t.Fatal("expected non-branch ref to fail")
	}
}

func TestParsePushMarksDeletedBranchPushes(t *testing.T) {
	push, err := ParsePush([]byte(`{
		"ref":"refs/heads/main",
		"after":"0000000000000000000000000000000000000000",
		"deleted":true,
		"repository":{"full_name":" acme/app "},
		"pusher":{"name":" ali "}
	}`))
	if err != nil {
		t.Fatal(err)
	}

	if !push.Deleted {
		t.Fatal("expected deleted branch push")
	}
	if push.Actor != "ali" || push.CommitSHA != "0000000000000000000000000000000000000000" {
		t.Fatalf("expected normalized push metadata, got %+v", push)
	}
}

func TestVerifySignature(t *testing.T) {
	body := []byte(`{"ok":true}`)
	mac := hmac.New(sha256.New, []byte("secret"))
	_, _ = mac.Write(body)
	signature := "sha256=" + hex.EncodeToString(mac.Sum(nil))

	if !VerifySignature("secret", body, signature) {
		t.Fatal("expected signature to verify")
	}
	if VerifySignature("other", body, signature) {
		t.Fatal("expected signature to fail")
	}
	if VerifySignature("", body, signature) {
		t.Fatal("expected missing secret to fail closed")
	}
	if VerifySignature("secret", body, "") {
		t.Fatal("expected missing signature to fail")
	}
	if !VerifySignature(" secret ", body, " "+signature+" ") {
		t.Fatal("expected trimmed secret and signature to verify")
	}
}
