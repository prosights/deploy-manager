package dockerx

import (
	"context"
	"fmt"
	"net"
	"strings"
	"unicode"

	"deploy-manager/internal/stringutil"

	"github.com/docker/docker/client"
)

type EngineStatus struct {
	Host       string `json:"host"`
	APIVersion string `json:"api_version"`
	OSType     string `json:"os_type"`
}

func SSHHost(user string, host string, port int32) string {
	if port == 0 {
		port = 22
	}
	return fmt.Sprintf("ssh://%s@%s", user, net.JoinHostPort(host, fmt.Sprintf("%d", port)))
}

func BuildSSHHost(user string, host string, port int32) (string, error) {
	user = strings.TrimSpace(user)
	host = strings.TrimSpace(host)
	if port == 0 {
		port = 22
	}
	if user == "" {
		return "", fmt.Errorf("ssh user is required")
	}
	if host == "" {
		return "", fmt.Errorf("ssh host is required")
	}
	if hasInvalidSSHUserPart(user) {
		return "", fmt.Errorf("ssh user contains invalid characters")
	}
	if hasInvalidSSHHostPart(host) {
		return "", fmt.Errorf("ssh host contains invalid characters")
	}
	if port < 1 || port > 65535 {
		return "", fmt.Errorf("ssh port must be between 1 and 65535")
	}
	return SSHHost(user, host, port), nil
}

func hasInvalidSSHUserPart(user string) bool {
	if strings.ContainsAny(user, "@/:") {
		return true
	}
	return hasInvalidSpace(user) || stringutil.HasControlCharacter(user)
}

func hasInvalidSSHHostPart(host string) bool {
	if strings.Contains(host, "://") || strings.ContainsAny(host, "@/") {
		return true
	}
	return hasInvalidSpace(host) || stringutil.HasControlCharacter(host)
}

func hasInvalidSpace(value string) bool {
	for _, char := range value {
		if unicode.IsSpace(char) {
			return true
		}
	}
	return false
}

func Check(ctx context.Context, host string) (EngineStatus, error) {
	cli, err := NewClient(ctx, host)
	if err != nil {
		return EngineStatus{}, err
	}
	defer cli.Close()

	version, err := cli.ServerVersion(ctx)
	if err != nil {
		return EngineStatus{}, err
	}

	return EngineStatus{
		Host:       host,
		APIVersion: version.APIVersion,
		OSType:     version.Os,
	}, nil
}

func NewClient(ctx context.Context, host string) (*client.Client, error) {
	options := []client.Opt{
		client.FromEnv,
		client.WithAPIVersionNegotiation(),
	}
	if host != "" {
		options = append(options, client.WithHost(host))
	}

	cli, err := client.NewClientWithOpts(options...)
	if err != nil {
		return nil, err
	}

	if _, err := cli.Ping(ctx); err != nil {
		_ = cli.Close()
		return nil, err
	}

	return cli, nil
}
