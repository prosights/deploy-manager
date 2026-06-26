package dockerx

import "testing"

func TestSSHHostBuildsDockerSSHHost(t *testing.T) {
	got := SSHHost("root", "example.com", 2222)
	want := "ssh://root@example.com:2222"
	if got != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}

func TestSSHHostDefaultsPort(t *testing.T) {
	got := SSHHost("deploy", "10.0.0.5", 0)
	want := "ssh://deploy@10.0.0.5:22"
	if got != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}

func TestBuildSSHHostTrimsInputs(t *testing.T) {
	got, err := BuildSSHHost(" deploy ", " example.com ", 0)
	if err != nil {
		t.Fatal(err)
	}
	want := "ssh://deploy@example.com:22"
	if got != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}

func TestBuildSSHHostRequiresUserAndHost(t *testing.T) {
	if _, err := BuildSSHHost("", "example.com", 22); err == nil {
		t.Fatal("expected missing user to fail")
	}
	if _, err := BuildSSHHost("deploy", "", 22); err == nil {
		t.Fatal("expected missing host to fail")
	}
}

func TestBuildSSHHostRejectsInvalidPorts(t *testing.T) {
	for _, port := range []int32{-1, 65536} {
		if _, err := BuildSSHHost("deploy", "example.com", port); err == nil {
			t.Fatalf("expected port %d to fail", port)
		}
	}
}

func TestBuildSSHHostRejectsAmbiguousUserAndHostParts(t *testing.T) {
	for _, test := range []struct {
		user string
		host string
	}{
		{user: "deploy@example", host: "example.com"},
		{user: "deploy user", host: "example.com"},
		{user: "deploy", host: "ssh://example.com"},
		{user: "deploy", host: "example.com/path"},
		{user: "deploy", host: "example .com"},
		{user: "deploy", host: "example\n.com"},
	} {
		if _, err := BuildSSHHost(test.user, test.host, 22); err == nil {
			t.Fatalf("expected user=%q host=%q to fail", test.user, test.host)
		}
	}
}

func TestBuildSSHHostAllowsIPv6Host(t *testing.T) {
	got, err := BuildSSHHost("deploy", "2001:db8::1", 22)
	if err != nil {
		t.Fatal(err)
	}
	want := "ssh://deploy@[2001:db8::1]:22"
	if got != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}
