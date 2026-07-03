package httpapi

import (
	"testing"

	"deploy-manager/internal/db"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestNormalizeCreateServerTrimsAndDefaults(t *testing.T) {
	input, err := normalizeCreateServer(db.CreateServerParams{
		Name:       " prod ",
		Hostname:   " 10.0.0.10 ",
		SshKeyPath: pgtype.Text{String: " ~/.ssh/id_ed25519 ", Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}

	if input.Name != "prod" || input.Hostname != "10.0.0.10" || input.SshUser != "root" || input.SshPort != 22 || input.ConnectionMode != "direct_ssh" || input.ProxyType != "caddy" {
		t.Fatalf("unexpected normalized server: %+v", input)
	}
	if input.SshKeyPath.String != "~/.ssh/id_ed25519" {
		t.Fatalf("expected trimmed SSH key path, got %q", input.SshKeyPath.String)
	}
}

func TestNormalizeCreateServerRejectsBlankRequiredFields(t *testing.T) {
	_, err := normalizeCreateServer(db.CreateServerParams{
		Name:     " ",
		Hostname: "10.0.0.10",
	})
	if err == nil {
		t.Fatal("expected blank name to fail")
	}
}

func TestNormalizeCreateServerRequiresSSHKeyPathForDirectSSH(t *testing.T) {
	_, err := normalizeCreateServer(db.CreateServerParams{
		Name:           "prod",
		Hostname:       "10.0.0.10",
		ConnectionMode: "direct_ssh",
	})
	if err == nil {
		t.Fatal("expected missing ssh key path to fail")
	}
}

func TestNormalizeCreateServerAllowsKeylessTailscaleSSH(t *testing.T) {
	input, err := normalizeCreateServer(db.CreateServerParams{
		Name:           "prod",
		Hostname:       "100.79.100.28",
		ConnectionMode: "tailscale_ssh",
	})
	if err != nil {
		t.Fatal(err)
	}
	if input.SshKeyPath.Valid {
		t.Fatalf("expected tailscale ssh key path to stay empty, got %+v", input.SshKeyPath)
	}
}

func TestNormalizeCreateServerDropsSSHKeyPathForTailscaleSSH(t *testing.T) {
	input, err := normalizeCreateServer(db.CreateServerParams{
		Name:           "prod",
		Hostname:       "100.79.100.28",
		ConnectionMode: "tailscale_ssh",
		SshKeyPath:     pgtype.Text{String: "~/.ssh/id_ed25519", Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if input.SshKeyPath.Valid {
		t.Fatalf("expected tailscale ssh key path to be discarded, got %+v", input.SshKeyPath)
	}
}

func TestNormalizeCreateServerRejectsNonTailnetTailscaleHost(t *testing.T) {
	_, err := normalizeCreateServer(db.CreateServerParams{
		Name:           "prod",
		Hostname:       "10.0.0.10",
		ConnectionMode: "tailscale_ssh",
	})
	if err == nil {
		t.Fatal("expected non-tailnet tailscale host to fail")
	}
}

func TestNormalizeCreateServerRejectsUnsupportedConnectionMode(t *testing.T) {
	for _, mode := range []string{"unknown", "cloud_tunnel"} {
		_, err := normalizeCreateServer(db.CreateServerParams{
			Name:           "prod",
			Hostname:       "10.0.0.10",
			SshKeyPath:     pgtype.Text{String: "~/.ssh/id_ed25519", Valid: true},
			ConnectionMode: mode,
		})
		if err == nil {
			t.Fatalf("expected unsupported connection mode %q to fail", mode)
		}
	}
}

func TestNormalizeCreateServerRejectsUnsupportedProxyType(t *testing.T) {
	_, err := normalizeCreateServer(db.CreateServerParams{
		Name:       "prod",
		Hostname:   "10.0.0.10",
		SshKeyPath: pgtype.Text{String: "~/.ssh/id_ed25519", Valid: true},
		ProxyType:  "nginx",
	})
	if err == nil {
		t.Fatal("expected unsupported proxy type to fail")
	}
}

func TestNormalizeCreateServerRejectsInvalidSSHPort(t *testing.T) {
	for _, port := range []int32{-1, 65536} {
		_, err := normalizeCreateServer(db.CreateServerParams{
			Name:       "prod",
			Hostname:   "10.0.0.10",
			SshPort:    port,
			SshKeyPath: pgtype.Text{String: "~/.ssh/id_ed25519", Valid: true},
		})
		if err == nil {
			t.Fatalf("expected port %d to fail", port)
		}
	}
}

func TestNormalizeCreateServerRejectsInvalidSSHTargetParts(t *testing.T) {
	for _, input := range []db.CreateServerParams{
		{Name: "prod", Hostname: "https://10.0.0.10", SshKeyPath: pgtype.Text{String: "~/.ssh/id_ed25519", Valid: true}},
		{Name: "prod", Hostname: "10.0.0.10", SshUser: "root@example", SshKeyPath: pgtype.Text{String: "~/.ssh/id_ed25519", Valid: true}},
		{Name: "prod", Hostname: "10.0.0.10/path", SshKeyPath: pgtype.Text{String: "~/.ssh/id_ed25519", Valid: true}},
	} {
		_, err := normalizeCreateServer(input)
		if err == nil {
			t.Fatalf("expected invalid SSH target to fail: %+v", input)
		}
	}
}

func TestNormalizeCreateServerRejectsControlCharacters(t *testing.T) {
	for _, input := range []db.CreateServerParams{
		{Name: "prod\n1", Hostname: "10.0.0.10", SshKeyPath: pgtype.Text{String: "~/.ssh/id_ed25519", Valid: true}},
		{Name: "prod", Hostname: "10.0.\t0.10", SshKeyPath: pgtype.Text{String: "~/.ssh/id_ed25519", Valid: true}},
		{Name: "prod", Hostname: "10.0.0.10", SshUser: "ro\rot", SshKeyPath: pgtype.Text{String: "~/.ssh/id_ed25519", Valid: true}},
		{Name: "prod", Hostname: "10.0.0.10", SshKeyPath: pgtype.Text{String: "~/.ssh/id_ed25519\nbad", Valid: true}},
	} {
		_, err := normalizeCreateServer(input)
		if err == nil {
			t.Fatalf("expected control character in server identity to fail: %+v", input)
		}
	}
}

func TestNormalizeCreateServerRejectsUnsafeSSHKeyPaths(t *testing.T) {
	for _, sshKeyPath := range []string{"id_ed25519", "~", "~/keys/id_ed25519", "~/.ssh//id_ed25519", "~/.ssh/../id_ed25519", "/Users/ali//.ssh/id_ed25519", "/Users/ali/../id_ed25519"} {
		t.Run(sshKeyPath, func(t *testing.T) {
			_, err := normalizeCreateServer(db.CreateServerParams{
				Name:       "prod",
				Hostname:   "10.0.0.10",
				SshKeyPath: pgtype.Text{String: sshKeyPath, Valid: true},
			})
			if err == nil {
				t.Fatal("expected unsafe ssh key path to fail")
			}
		})
	}
}

func TestServerCreateAuditMetadataShowsSSHInventoryTracking(t *testing.T) {
	metadata := serverCreateAuditMetadata("10.0.0.10", "tailscale_ssh", "caddy", pgtype.Text{String: "~/.ssh/id_ed25519", Valid: true})

	if metadata["hostname"] != "10.0.0.10" || metadata["connection_mode"] != "tailscale_ssh" || metadata["proxy_type"] != "caddy" {
		t.Fatalf("unexpected server metadata: %+v", metadata)
	}
	if metadata["ssh_inventory_tracked"] != true {
		t.Fatalf("expected SSH inventory tracking marker, got %+v", metadata)
	}
}
