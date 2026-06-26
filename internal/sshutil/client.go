package sshutil

import (
	"context"
	"fmt"
	"net"
	"os"
	"strings"
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
	hostKeyCallback ssh.HostKeyCallback
}

type ClientOptions struct {
	HostKeyCallback ssh.HostKeyCallback
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
		hostKeyCallback: options.HostKeyCallback,
	}
}

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

	done := make(chan struct{})
	var output []byte
	var runErr error
	go func() {
		output, runErr = session.CombinedOutput(command)
		close(done)
	}()

	select {
	case <-ctx.Done():
		_ = session.Signal(ssh.SIGKILL)
		return string(output), ctx.Err()
	case <-done:
		return string(output), runErr
	}
}

func (c Client) connect(ctx context.Context) (*ssh.Client, error) {
	if c.signer == nil {
		return nil, fmt.Errorf("ssh signer is required")
	}
	if c.host == "" {
		return nil, fmt.Errorf("host is required")
	}

	address := net.JoinHostPort(c.host, fmt.Sprintf("%d", c.port))
	config := &ssh.ClientConfig{
		User:            c.user,
		Auth:            []ssh.AuthMethod{ssh.PublicKeys(c.signer)},
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
