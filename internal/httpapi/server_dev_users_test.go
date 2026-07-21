package httpapi

import (
	"reflect"
	"strings"
	"testing"

	"deploy-manager/internal/db"
)

func TestParseDevUsersFileNormalizesAndSorts(t *testing.T) {
	users, err := parseDevUsersFile(`
# comment
narasaka
rootsec1 # inline comment
narasaka
pramitbhatia
`)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"narasaka", "pramitbhatia", "rootsec1"}
	if !reflect.DeepEqual(users, want) {
		t.Fatalf("users = %+v, want %+v", users, want)
	}
}

func TestNormalizeDevUsernameRejectsInvalidLinuxNames(t *testing.T) {
	for _, username := range []string{"", "Root", "bad name", "1first", "bad/slash", strings.Repeat("a", devUsersMaxUsernameLength+1)} {
		t.Run(username, func(t *testing.T) {
			if _, err := normalizeDevUsername(username); err == nil {
				t.Fatal("expected invalid username")
			}
		})
	}
}

func TestDevUserMutationsAreIdempotent(t *testing.T) {
	users := addDevUser([]string{"rootsec1"}, "narasaka")
	users = addDevUser(users, "narasaka")
	want := []string{"narasaka", "rootsec1"}
	if !reflect.DeepEqual(users, want) {
		t.Fatalf("users = %+v, want %+v", users, want)
	}

	users, err := replaceDevUser(users, "rootsec1", "pramitbhatia")
	if err != nil {
		t.Fatal(err)
	}
	want = []string{"narasaka", "pramitbhatia"}
	if !reflect.DeepEqual(users, want) {
		t.Fatalf("users = %+v, want %+v", users, want)
	}

	users, err = replaceDevUser(users, "pramitbhatia", "pramitbhatia")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(users, want) {
		t.Fatalf("users = %+v, want %+v", users, want)
	}

	users = removeDevUser(users, "narasaka")
	want = []string{"pramitbhatia"}
	if !reflect.DeepEqual(users, want) {
		t.Fatalf("users = %+v, want %+v", users, want)
	}
}

func TestRemoteDevUsersApplyCommandUsesBash(t *testing.T) {
	command := remoteDevUsersApplyCommand(db.Server{SshUser: "ali_prosights_co"}, []string{"narasaka"})

	if !strings.HasPrefix(command, "bash -lc ") {
		t.Fatalf("expected remote apply to run under bash, got %q", command)
	}
	if !strings.Contains(command, "PROSIGHTS_USERS") || !strings.Contains(command, "narasaka") {
		t.Fatalf("expected rendered users file in command, got %q", command)
	}
	if !strings.Contains(command, "groupadd --system sudo") {
		t.Fatalf("expected command to create the sudo group when missing, got %q", command)
	}
}

func TestLocalHostDevUsersApplyCommandTargetsHostFilesystem(t *testing.T) {
	command := localHostDevUsersApplyCommand(db.Server{SshUser: "ali_prosights_co"}, []string{"narasaka"})

	for _, want := range []string{
		"docker run --rm --privileged -i -v /:/host alpine:3.23",
		"cat > /host/srv/deploy-manager/ops/dev-sudo-users.txt",
		"chroot /host '/srv/deploy-manager/ops/provision-dev-sudo-users.sh' '/srv/deploy-manager/ops/dev-sudo-users.txt'",
		"chroot /host chown -R 'ali_prosights_co':deployers /srv/deploy-manager/ops",
	} {
		if !strings.Contains(command, want) {
			t.Fatalf("expected command to contain %q, got %q", want, command)
		}
	}
}
