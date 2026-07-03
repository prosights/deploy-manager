package sshutil

import (
	"context"
	"fmt"
	"net"
	"net/netip"
	"os"
	"strings"
	"sync"
	"time"

	"deploy-manager/internal/stringutil"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

type Client struct {
	host            string
	port            int32
	user            string
	signer          ssh.Signer
	authMethods     []ssh.AuthMethod
	allowNoAuth     bool
	hostKeyCallback ssh.HostKeyCallback
}

type ClientOptions struct {
	HostKeyCallback ssh.HostKeyCallback
	AuthMethods     []ssh.AuthMethod
	AllowNoAuth     bool
}

func LoadSigner(path string) (ssh.Signer, error) {
	if path == "" {
		return nil, fmt.Errorf("ssh key path is required")
	}

	key, err := os.ReadFile(expandPath(path))
	if err != nil {
		return nil, err
	}
	return ssh.ParsePrivateKey(key)
}

func NewClient(host string, port int32, user string, signer ssh.Signer) Client {
	return NewClientWithOptions(host, port, user, signer, ClientOptions{})
}

func NewClientWithOptions(host string, port int32, user string, signer ssh.Signer, options ClientOptions) Client {
	if options.HostKeyCallback == nil {
		options.HostKeyCallback = defaultHostKeyCallback()
	}

	return Client{
		host:            host,
		port:            port,
		user:            user,
		signer:          signer,
		authMethods:     options.AuthMethods,
		allowNoAuth:     options.AllowNoAuth,
		hostKeyCallback: options.HostKeyCallback,
	}
}

func NewTailscaleSSHClient(host string, port int32, user string) Client {
	return NewClientWithOptions(host, port, user, nil, ClientOptions{
		AllowNoAuth:     true,
		HostKeyCallback: tailscaleHostKeyCallback(),
	})
}

// maxSSHOutputBytes caps how much combined stdout+stderr we buffer from a
// remote command. A misbehaving or compromised host could otherwise stream
// unbounded output and exhaust memory before any downstream truncation runs.
const maxSSHOutputBytes = 1 << 20

func (c Client) Run(ctx context.Context, command string) (string, error) {
	sshClient, err := c.connect(ctx)
	if err != nil {
		return "", err
	}
	defer sshClient.Close()

	session, err := sshClient.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()

	buffer := &cappedBuffer{limit: maxSSHOutputBytes}
	session.Stdout = buffer
	session.Stderr = buffer

	done := make(chan error, 1)
	go func() {
		done <- session.Run(command)
	}()

	select {
	case <-ctx.Done():
		_ = session.Signal(ssh.SIGKILL)
		return "", ctx.Err()
	case runErr := <-done:
		return buffer.String(), runErr
	}
}

func (c Client) Connect(ctx context.Context) (*ssh.Client, error) {
	return c.connect(ctx)
}

// cappedBuffer accumulates output up to limit bytes and silently discards the
// rest. Writes never fail so the underlying SSH session is not torn down by a
// short-write error; we simply stop retaining bytes once the cap is reached.
type cappedBuffer struct {
	mu    sync.Mutex
	buf   []byte
	limit int
}

func (b *cappedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if remaining := b.limit - len(b.buf); remaining > 0 {
		if len(p) > remaining {
			b.buf = append(b.buf, p[:remaining]...)
		} else {
			b.buf = append(b.buf, p...)
		}
	}
	return len(p), nil
}

func (b *cappedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return string(b.buf)
}

func (c Client) connect(ctx context.Context) (*ssh.Client, error) {
	authMethods := c.authMethods
	if len(authMethods) == 0 && c.signer != nil {
		authMethods = []ssh.AuthMethod{ssh.PublicKeys(c.signer)}
	}
	if len(authMethods) == 0 && !c.allowNoAuth {
		return nil, fmt.Errorf("ssh signer is required")
	}
	if c.host == "" {
		return nil, fmt.Errorf("host is required")
	}
	if c.allowNoAuth {
		if err := ValidateTailscaleHost(c.host); err != nil {
			return nil, err
		}
	}

	address := net.JoinHostPort(c.host, fmt.Sprintf("%d", c.port))
	config := &ssh.ClientConfig{
		User:            c.user,
		Auth:            authMethods,
		HostKeyCallback: c.hostKeyCallback,
		Timeout:         5 * time.Second,
	}

	dialer := net.Dialer{Timeout: 5 * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", address)
	if err != nil {
		return nil, err
	}

	sshConn, chans, reqs, err := ssh.NewClientConn(conn, address, config)
	if err != nil {
		conn.Close()
		return nil, err
	}
	return ssh.NewClient(sshConn, chans, reqs), nil
}

func defaultHostKeyCallback() ssh.HostKeyCallback {
	return knownHostsCallback(defaultKnownHostsPath())
}

func ValidateTailscaleHost(host string) error {
	host = strings.Trim(strings.ToLower(strings.TrimSpace(host)), "[]")
	if host == "" {
		return fmt.Errorf("tailscale ssh host is required")
	}
	if addr, err := netip.ParseAddr(host); err == nil {
		if netip.MustParsePrefix("100.64.0.0/10").Contains(addr) || netip.MustParsePrefix("fd7a:115c:a1e0::/48").Contains(addr) {
			return nil
		}
		return fmt.Errorf("tailscale ssh host must be a tailnet IP or MagicDNS name")
	}
	if strings.HasSuffix(host, ".ts.net") && safeDNSName(host) {
		return nil
	}
	return fmt.Errorf("tailscale ssh host must be a tailnet IP or MagicDNS name")
}

func safeDNSName(host string) bool {
	if strings.Contains(host, "..") {
		return false
	}
	for _, char := range host {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char == '.' || char == '-' {
			continue
		}
		return false
	}
	return true
}

func tailscaleHostKeyCallback() ssh.HostKeyCallback {
	return func(string, net.Addr, ssh.PublicKey) error {
		return nil
	}
}

func knownHostsCallback(path string) ssh.HostKeyCallback {
	callback, err := knownhosts.New(path)
	if err == nil {
		return callback
	}

	return func(string, net.Addr, ssh.PublicKey) error {
		return fmt.Errorf("load known_hosts %s: %w", path, err)
	}
}

func expandPath(path string) string {
	return stringutil.ExpandHome(path)
}

func defaultKnownHostsPath() string {
	path := strings.TrimSpace(os.Getenv("SSH_KNOWN_HOSTS_PATH"))
	if path == "" {
		path = "~/.ssh/known_hosts"
	}
	return expandPath(path)
}
