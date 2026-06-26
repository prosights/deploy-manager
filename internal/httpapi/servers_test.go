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

	if input.Name != "prod" || input.Hostname != "10.0.0.10" || input.SshUser != "root" || input.SshPort != 22 || input.ProxyType != "caddy" {
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

func TestNormalizeCreateServerRequiresSSHKeyPath(t *testing.T) {
	_, err := normalizeCreateServer(db.CreateServerParams{
		Name:     "prod",
		Hostname: "10.0.0.10",
	})
	if err == nil {
		t.Fatal("expected missing ssh key path to fail")
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
	for _, sshKeyPath := range []string{"id_ed25519", "~", "~/.ssh//id_ed25519", "~/.ssh/../id_ed25519", "/Users/ali//.ssh/id_ed25519", "/Users/ali/../id_ed25519"} {
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
	metadata := serverCreateAuditMetadata("10.0.0.10", "caddy", pgtype.Text{String: "~/.ssh/id_ed25519", Valid: true})

	if metadata["hostname"] != "10.0.0.10" || metadata["proxy_type"] != "caddy" {
		t.Fatalf("unexpected server metadata: %+v", metadata)
	}
	if metadata["ssh_inventory_tracked"] != true {
		t.Fatalf("expected SSH inventory tracking marker, got %+v", metadata)
	}
}
