package githubhook

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

type PushPayload struct {
	Ref        string `json:"ref"`
	After      string `json:"after"`
	Deleted    bool   `json:"deleted"`
	Repository struct {
		FullName string `json:"full_name"`
		HTMLURL  string `json:"html_url"`
		CloneURL string `json:"clone_url"`
		SSHURL   string `json:"ssh_url"`
	} `json:"repository"`
	Pusher struct {
		Name string `json:"name"`
	} `json:"pusher"`
	Sender struct {
		Login string `json:"login"`
	} `json:"sender"`
}

type Push struct {
	Branch       string
	CommitSHA    string
	Actor        string
	Deleted      bool
	Repositories []string
}

func ParsePush(body []byte) (Push, error) {
	var payload PushPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		return Push{}, err
	}

	branch := strings.TrimSpace(strings.TrimPrefix(payload.Ref, "refs/heads/"))
	if branch == "" || branch == payload.Ref {
		return Push{}, fmt.Errorf("push ref must be a branch")
	}

	repositories := repositoryAliases(payload)
	if len(repositories) == 0 {
		return Push{}, fmt.Errorf("repository is required")
	}

	actor := strings.TrimSpace(payload.Sender.Login)
	if actor == "" {
		actor = strings.TrimSpace(payload.Pusher.Name)
	}

	return Push{
		Branch:       branch,
		CommitSHA:    strings.TrimSpace(payload.After),
		Actor:        actor,
		Deleted:      payload.Deleted,
		Repositories: repositories,
	}, nil
}

func VerifySignature(secret string, body []byte, signature string) bool {
	secret = strings.TrimSpace(secret)
	signature = strings.TrimSpace(signature)
	if secret == "" || signature == "" {
		return false
	}

	const prefix = "sha256="
	if !strings.HasPrefix(signature, prefix) {
		return false
	}

	expectedMAC := hmac.New(sha256.New, []byte(secret))
	_, _ = expectedMAC.Write(body)
	expected := expectedMAC.Sum(nil)

	actual, err := hex.DecodeString(strings.TrimPrefix(signature, prefix))
	if err != nil {
		return false
	}
	return hmac.Equal(actual, expected)
}

func repositoryAliases(payload PushPayload) []string {
	seen := map[string]struct{}{}
	aliases := make([]string, 0, 4)
	fullName := strings.TrimSpace(payload.Repository.FullName)
	if validGitHubFullName(fullName) {
		aliases = appendGitHubAlias(aliases, seen, "git@github.com:"+fullName+".git")
		aliases = appendGitHubAlias(aliases, seen, "https://github.com/"+fullName)
		aliases = appendGitHubAlias(aliases, seen, "https://github.com/"+fullName+".git")
	}

	for _, value := range []string{payload.Repository.SSHURL, payload.Repository.CloneURL, payload.Repository.HTMLURL} {
		aliases = appendGitHubAlias(aliases, seen, strings.TrimSpace(value))
	}
	return aliases
}

var (
	githubFullNamePattern = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)
	githubRemotePattern   = regexp.MustCompile(`^(git@github\.com:[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\.git|https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:\.git)?)$`)
)

func validGitHubFullName(value string) bool {
	return githubFullNamePattern.MatchString(value)
}

func appendGitHubAlias(aliases []string, seen map[string]struct{}, value string) []string {
	if !githubRemotePattern.MatchString(value) {
		return aliases
	}
	if _, ok := seen[value]; ok {
		return aliases
	}
	seen[value] = struct{}{}
	return append(aliases, value)
}
