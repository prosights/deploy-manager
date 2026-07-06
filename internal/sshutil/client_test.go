package sshutil

import (
	"context"
	"crypto/ed25519"
	"net"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

// blockingSSHServer accepts one connection and one session "exec" request,
// then blocks forever without responding. It exists so the Run cancellation
// path can be exercised: the remote command never completes on its own, so the
// only way Run returns is via context cancellation.
func blockingSSHServer(t *testing.T) (addr string, hostKey ssh.PublicKey) {
	t.Helper()

	_, serverPriv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	hostSigner, err := ssh.NewSignerFromKey(serverPriv)
	if err != nil {
		t.Fatal(err)
	}

	config := &ssh.ServerConfig{
		PublicKeyCallback: func(ssh.ConnMetadata, ssh.PublicKey) (*ssh.Permissions, error) {
			return &ssh.Permissions{}, nil
		},
	}
	config.AddHostKey(hostSigner)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })

	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		sshConn, chans, reqs, err := ssh.NewServerConn(conn, config)
		if err != nil {
			return
		}
		defer sshConn.Close()
		go ssh.DiscardRequests(reqs)

		for newChannel := range chans {
			if newChannel.ChannelType() != "session" {
				_ = newChannel.Reject(ssh.UnknownChannelType, "only sessions")
				continue
			}
			channel, requests, err := newChannel.Accept()
			if err != nil {
				return
			}
			// Accept the exec request, then stream output continuously and
			// never send an exit-status. The constant writes mean the client's
			// CombinedOutput is actively appending to its buffer when the
			// context is cancelled, which is the condition that exposes the
			// data race in the pre-fix implementation.
			go func() {
				for req := range requests {
					if req.WantReply {
						_ = req.Reply(true, nil)
					}
				}
			}()
			go func() {
				buf := make([]byte, 256)
				for {
					if _, err := channel.Write(buf); err != nil {
						return
					}
				}
			}()
		}
	}()

	return listener.Addr().String(), hostSigner.PublicKey()
}

func TestCappedBufferStopsAtLimit(t *testing.T) {
	buf := &cappedBuffer{limit: 10}
	n, err := buf.Write([]byte("hello"))
	if err != nil || n != 5 {
		t.Fatalf("expected Write to report 5 bytes consumed, got n=%d err=%v", n, err)
	}
	// Second write overflows the cap; Write still reports the full length so the
	// SSH session is not torn down, but only the first 10 bytes are retained.
	n, err = buf.Write([]byte("world wide web"))
	if err != nil || n != 14 {
		t.Fatalf("expected Write to report 14 bytes consumed, got n=%d err=%v", n, err)
	}
	if got := buf.String(); got != "helloworld" {
		t.Fatalf("expected capped output %q, got %q", "helloworld", got)
	}
}

func TestRunReturnsPromptlyOnContextCancellation(t *testing.T) {
	addr, hostKey := blockingSSHServer(t)
	host, portStr, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatal(err)
	}
	port, err := net.LookupPort("tcp", portStr)
	if err != nil {
		t.Fatal(err)
	}

	_, clientPriv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	clientSigner, err := ssh.NewSignerFromKey(clientPriv)
	if err != nil {
		t.Fatal(err)
	}

	client := NewClientWithOptions(host, int32(port), "deploy", clientSigner, ClientOptions{
		HostKeyCallback: ssh.FixedHostKey(hostKey),
	})

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	returned := make(chan error, 1)
	go func() {
		_, runErr := client.Run(ctx, "sleep forever")
		returned <- runErr
	}()

	select {
	case runErr := <-returned:
		if runErr == nil {
			t.Fatal("expected a context error, got nil")
		}
		if runErr != context.DeadlineExceeded {
			t.Fatalf("expected context.DeadlineExceeded, got %v", runErr)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Run did not return after context cancellation")
	}
}

func TestTailscaleSSHClientAllowsNoSigner(t *testing.T) {
	client := NewTailscaleSSHClient("100.79.100.28", 22, "deploy")

	if !client.allowNoAuth {
		t.Fatal("expected tailscale ssh client to allow keyless auth")
	}
	if len(client.authMethods) != 0 || client.signer != nil {
		t.Fatalf("expected tailscale ssh client to avoid static auth methods, got %+v", client)
	}
	if !client.tailscaleCLI {
		t.Fatal("expected tailscale ssh client to use the Tailscale CLI transport")
	}
}

func TestStripTailscaleWarningsKeepsCommandOutput(t *testing.T) {
	output := "Warning: client version \"1.90.9-AlpineLinux\" != tailscaled server version \"1.98.4\"\n27.0 linux\n"

	if got := stripTailscaleWarnings(output); got != "27.0 linux\n" {
		t.Fatalf("expected warning to be removed, got %q", got)
	}
}

func TestValidateTailscaleHost(t *testing.T) {
	for _, host := range []string{"100.79.100.28", "fd7a:115c:a1e0::1", "workflows.tail897611.ts.net"} {
		if err := ValidateTailscaleHost(host); err != nil {
			t.Fatalf("expected %q to be accepted: %v", host, err)
		}
	}
	for _, host := range []string{"10.0.0.10", "example.com", "bad host.ts.net"} {
		if err := ValidateTailscaleHost(host); err == nil {
			t.Fatalf("expected %q to be rejected", host)
		}
	}
}
