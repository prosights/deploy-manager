package githubconnector

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const defaultGitHubAPIURL = "https://api.github.com"

type AppClient struct {
	appID      string
	privateKey *rsa.PrivateKey
	httpClient *http.Client
	baseURL    string
}

type AppRepository struct {
	ID            int64  `json:"id"`
	FullName      string `json:"full_name"`
	DefaultBranch string `json:"default_branch"`
	CloneURL      string `json:"clone_url"`
	HTMLURL       string `json:"html_url"`
}

type RepositoryContent struct {
	Name string `json:"name"`
	Path string `json:"path"`
	Type string `json:"type"`
}

type RepositoryCommit struct {
	SHA             string `json:"sha"`
	Message         string `json:"message"`
	AuthorName      string `json:"author_name"`
	AuthorLogin     string `json:"author_login"`
	AuthorAvatarURL string `json:"author_avatar_url"`
	HTMLURL         string `json:"html_url"`
}

type repositoryFile struct {
	Type     string `json:"type"`
	Encoding string `json:"encoding"`
	Content  string `json:"content"`
}

func NewAppClient(appID string, privateKeyPEM string, httpClient *http.Client) (*AppClient, error) {
	appID = strings.TrimSpace(appID)
	if appID == "" {
		return nil, fmt.Errorf("github app id is required")
	}
	privateKey, err := parsePrivateKey(privateKeyPEM)
	if err != nil {
		return nil, err
	}
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 15 * time.Second}
	}
	return &AppClient{
		appID:      appID,
		privateKey: privateKey,
		httpClient: httpClient,
		baseURL:    defaultGitHubAPIURL,
	}, nil
}

func (c *AppClient) ListInstallationRepositories(ctx context.Context, installationID string) ([]AppRepository, error) {
	installationID = strings.TrimSpace(installationID)
	if !validNumericID(installationID) {
		return nil, fmt.Errorf("installation_id must be numeric")
	}
	token, err := c.installationToken(ctx, installationID)
	if err != nil {
		return nil, err
	}

	var repositories []AppRepository
	path := "/installation/repositories?per_page=100"
	for path != "" {
		var response struct {
			Repositories []AppRepository `json:"repositories"`
		}
		next, err := c.getJSON(ctx, path, token, &response)
		if err != nil {
			return nil, err
		}
		repositories = append(repositories, response.Repositories...)
		path = next
	}
	return repositories, nil
}

func (c *AppClient) DispatchWorkflow(ctx context.Context, installationID string, repository string, workflowID string, ref string, inputs map[string]string) error {
	installationID = strings.TrimSpace(installationID)
	if !validNumericID(installationID) {
		return fmt.Errorf("installation_id must be numeric")
	}
	repository = strings.TrimSpace(repository)
	if !validRepository(repository) {
		return fmt.Errorf("repository must be owner/name")
	}
	workflowID = strings.TrimSpace(workflowID)
	if workflowID == "" || strings.ContainsAny(workflowID, "/\\\r\n\t") {
		return fmt.Errorf("workflow_id must be a workflow file name or numeric id")
	}
	ref = strings.TrimSpace(ref)
	if !validBranch(ref) {
		return fmt.Errorf("ref contains unsupported characters")
	}
	token, err := c.installationToken(ctx, installationID)
	if err != nil {
		return err
	}
	body := struct {
		Ref    string            `json:"ref"`
		Inputs map[string]string `json:"inputs,omitempty"`
	}{Ref: ref, Inputs: inputs}
	path := "/repos/" + repository + "/actions/workflows/" + url.PathEscape(workflowID) + "/dispatches"
	return c.postJSONBody(ctx, path, token, body, nil)
}

func (c *AppClient) ListRepositoryContents(ctx context.Context, installationID string, repository string, dir string, ref string) ([]RepositoryContent, error) {
	installationID = strings.TrimSpace(installationID)
	if !validNumericID(installationID) {
		return nil, fmt.Errorf("installation_id must be numeric")
	}
	repository = strings.TrimSpace(repository)
	if !validRepository(repository) {
		return nil, fmt.Errorf("repository must be owner/name")
	}
	dir = strings.Trim(strings.TrimSpace(dir), "/")
	if strings.ContainsAny(dir, "\r\n\t") || strings.Contains(dir, "..") {
		return nil, fmt.Errorf("dir contains unsupported characters")
	}
	ref = strings.TrimSpace(ref)
	if ref != "" && !validBranch(ref) {
		return nil, fmt.Errorf("ref contains unsupported characters")
	}
	token, err := c.installationToken(ctx, installationID)
	if err != nil {
		return nil, err
	}
	path := "/repos/" + repository + "/contents"
	if dir != "" {
		path += "/" + url.PathEscape(dir)
	}
	if ref != "" {
		path += "?ref=" + url.QueryEscape(ref)
	}
	var contents []RepositoryContent
	if _, err := c.getJSON(ctx, path, token, &contents); err != nil {
		return nil, err
	}
	return contents, nil
}

func (c *AppClient) GetRepositoryFile(ctx context.Context, installationID string, repository string, filePath string, ref string) ([]byte, error) {
	installationID = strings.TrimSpace(installationID)
	if !validNumericID(installationID) {
		return nil, fmt.Errorf("installation_id must be numeric")
	}
	repository = strings.TrimSpace(repository)
	if !validRepository(repository) {
		return nil, fmt.Errorf("repository must be owner/name")
	}
	filePath = strings.Trim(strings.TrimSpace(filePath), "/")
	if filePath == "" || strings.ContainsAny(filePath, "\r\n\t") || strings.Contains(filePath, "..") {
		return nil, fmt.Errorf("file path contains unsupported characters")
	}
	ref = strings.TrimSpace(ref)
	if ref != "" && !validBranch(ref) {
		return nil, fmt.Errorf("ref contains unsupported characters")
	}
	token, err := c.installationToken(ctx, installationID)
	if err != nil {
		return nil, err
	}
	requestPath := "/repos/" + repository + "/contents/" + url.PathEscape(filePath)
	if ref != "" {
		requestPath += "?ref=" + url.QueryEscape(ref)
	}
	var file repositoryFile
	if _, err := c.getJSON(ctx, requestPath, token, &file); err != nil {
		return nil, err
	}
	if file.Type != "file" || file.Encoding != "base64" {
		return nil, fmt.Errorf("github content response was not a base64 file")
	}
	content, err := base64.StdEncoding.DecodeString(strings.ReplaceAll(file.Content, "\n", ""))
	if err != nil {
		return nil, fmt.Errorf("decode github file content: %w", err)
	}
	return content, nil
}

func (c *AppClient) ListRepositoryBranches(ctx context.Context, installationID string, repository string) ([]string, error) {
	installationID = strings.TrimSpace(installationID)
	if !validNumericID(installationID) {
		return nil, fmt.Errorf("installation_id must be numeric")
	}
	repository = strings.TrimSpace(repository)
	if !validRepository(repository) {
		return nil, fmt.Errorf("repository must be owner/name")
	}
	token, err := c.installationToken(ctx, installationID)
	if err != nil {
		return nil, err
	}
	branches := make([]string, 0)
	path := "/repos/" + repository + "/branches?per_page=100"
	for path != "" {
		var response []struct {
			Name string `json:"name"`
		}
		next, err := c.getJSON(ctx, path, token, &response)
		if err != nil {
			return nil, err
		}
		for _, branch := range response {
			if branch.Name != "" {
				branches = append(branches, branch.Name)
			}
		}
		path = next
	}
	return branches, nil
}

func (c *AppClient) GetRepositoryCommit(ctx context.Context, installationID string, repository string, sha string) (RepositoryCommit, error) {
	installationID = strings.TrimSpace(installationID)
	if !validNumericID(installationID) {
		return RepositoryCommit{}, fmt.Errorf("installation_id must be numeric")
	}
	repository = strings.TrimSpace(repository)
	if !validRepository(repository) {
		return RepositoryCommit{}, fmt.Errorf("repository must be owner/name")
	}
	sha = strings.TrimSpace(sha)
	if !validCommitSHA(sha) {
		return RepositoryCommit{}, fmt.Errorf("sha must be a 7 to 40 character hexadecimal commit")
	}
	token, err := c.installationToken(ctx, installationID)
	if err != nil {
		return RepositoryCommit{}, err
	}
	var response struct {
		SHA     string `json:"sha"`
		HTMLURL string `json:"html_url"`
		Commit  struct {
			Message string `json:"message"`
			Author  struct {
				Name string `json:"name"`
			} `json:"author"`
		} `json:"commit"`
		Author struct {
			Login     string `json:"login"`
			AvatarURL string `json:"avatar_url"`
		} `json:"author"`
	}
	if _, err := c.getJSON(ctx, "/repos/"+repository+"/commits/"+sha, token, &response); err != nil {
		return RepositoryCommit{}, err
	}
	message := strings.TrimSpace(strings.SplitN(strings.ReplaceAll(response.Commit.Message, "\r\n", "\n"), "\n", 2)[0])
	return RepositoryCommit{
		SHA:             response.SHA,
		Message:         message,
		AuthorName:      strings.TrimSpace(response.Commit.Author.Name),
		AuthorLogin:     strings.TrimSpace(response.Author.Login),
		AuthorAvatarURL: strings.TrimSpace(response.Author.AvatarURL),
		HTMLURL:         strings.TrimSpace(response.HTMLURL),
	}, nil
}

// InstallationToken returns a short-lived, read-only token scoped to one
// repository. Callers must keep it in memory and must not log or persist it.
func (c *AppClient) InstallationToken(ctx context.Context, installationID string, repositoryID string) (string, error) {
	installationID = strings.TrimSpace(installationID)
	if !validNumericID(installationID) {
		return "", fmt.Errorf("installation_id must be numeric")
	}
	repositoryID = strings.TrimSpace(repositoryID)
	if !validNumericID(repositoryID) {
		return "", fmt.Errorf("repository_id must be numeric")
	}
	numericRepositoryID, err := strconv.ParseInt(repositoryID, 10, 64)
	if err != nil {
		return "", fmt.Errorf("repository_id must fit in an int64")
	}
	return c.createInstallationToken(ctx, installationID, struct {
		RepositoryIDs []int64           `json:"repository_ids"`
		Permissions   map[string]string `json:"permissions"`
	}{
		RepositoryIDs: []int64{numericRepositoryID},
		Permissions:   map[string]string{"contents": "read"},
	})
}

func (c *AppClient) installationToken(ctx context.Context, installationID string) (string, error) {
	return c.createInstallationToken(ctx, installationID, nil)
}

func (c *AppClient) createInstallationToken(ctx context.Context, installationID string, scope any) (string, error) {
	jwt, err := c.jwt(time.Now())
	if err != nil {
		return "", err
	}
	var response struct {
		Token string `json:"token"`
	}
	path := "/app/installations/" + installationID + "/access_tokens"
	if err := c.postJSONBody(ctx, path, jwt, scope, &response); err != nil {
		return "", err
	}
	if strings.TrimSpace(response.Token) == "" {
		return "", fmt.Errorf("github installation token response was empty")
	}
	return response.Token, nil
}

func (c *AppClient) jwt(now time.Time) (string, error) {
	header := map[string]string{"alg": "RS256", "typ": "JWT"}
	claims := map[string]any{
		"iat": now.Add(-1 * time.Minute).Unix(),
		"exp": now.Add(9 * time.Minute).Unix(),
		"iss": c.appID,
	}
	encodedHeader, err := encodeSegment(header)
	if err != nil {
		return "", err
	}
	encodedClaims, err := encodeSegment(claims)
	if err != nil {
		return "", err
	}
	signingInput := encodedHeader + "." + encodedClaims
	digest := sha256.Sum256([]byte(signingInput))
	signature, err := rsa.SignPKCS1v15(rand.Reader, c.privateKey, crypto.SHA256, digest[:])
	if err != nil {
		return "", fmt.Errorf("sign github app jwt: %w", err)
	}
	return signingInput + "." + base64.RawURLEncoding.EncodeToString(signature), nil
}

func (c *AppClient) postJSON(ctx context.Context, path string, bearer string, out any) error {
	return c.postJSONBody(ctx, path, bearer, nil, out)
}

func (c *AppClient) postJSONBody(ctx context.Context, path string, bearer string, body any, out any) error {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, reader)
	if err != nil {
		return err
	}
	if reader != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	request.Header.Set("Authorization", "Bearer "+bearer)
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	response, err := c.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("call github api: %w", err)
	}
	defer response.Body.Close()
	return decodeGitHubResponse(response, out)
}

func (c *AppClient) getJSON(ctx context.Context, path string, token string, out any) (string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return "", err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	response, err := c.httpClient.Do(request)
	if err != nil {
		return "", fmt.Errorf("call github api: %w", err)
	}
	defer response.Body.Close()
	if err := decodeGitHubResponse(response, out); err != nil {
		return "", err
	}
	return nextGitHubPage(response.Header.Get("Link")), nil
}

func decodeGitHubResponse(response *http.Response, out any) error {
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		message := strings.TrimSpace(string(body))
		if message != "" {
			return fmt.Errorf("github api returned %s: %s", response.Status, message)
		}
		return fmt.Errorf("github api returned %s", response.Status)
	}
	if len(bytes.TrimSpace(body)) == 0 {
		return nil
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("decode github api response: %w", err)
	}
	return nil
}

func parsePrivateKey(value string) (*rsa.PrivateKey, error) {
	value = strings.TrimSpace(strings.ReplaceAll(value, `\n`, "\n"))
	if value == "" {
		return nil, fmt.Errorf("github app private key is required")
	}
	block, _ := pem.Decode([]byte(value))
	if block == nil {
		return nil, fmt.Errorf("github app private key must be PEM encoded")
	}
	if key, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return key, nil
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse github app private key: %w", err)
	}
	key, ok := parsed.(*rsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("github app private key must be RSA")
	}
	return key, nil
}

func encodeSegment(value any) (string, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(encoded), nil
}

func nextGitHubPage(linkHeader string) string {
	for _, part := range strings.Split(linkHeader, ",") {
		part = strings.TrimSpace(part)
		if !strings.Contains(part, `rel="next"`) {
			continue
		}
		start := strings.Index(part, "<")
		end := strings.Index(part, ">")
		if start < 0 || end <= start {
			continue
		}
		next := part[start+1 : end]
		if strings.HasPrefix(next, defaultGitHubAPIURL) {
			return strings.TrimPrefix(next, defaultGitHubAPIURL)
		}
	}
	return ""
}
