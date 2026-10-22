package migrations

import (
	"crypto/sha256"
	"fmt"
	"testing"
)

func TestMigrationNamesAreSorted(t *testing.T) {
	names, err := migrationNames()
	if err != nil {
		t.Fatal(err)
	}
	if len(names) == 0 {
		t.Fatal("expected embedded migrations")
	}
	if names[0] != "001_initial.sql" {
		t.Fatalf("expected initial migration first, got %q", names[0])
	}
}

// Released migrations are applied in production; edits must go in a new file.
func TestReleasedMigrationsRemainImmutable(t *testing.T) {
	names, err := migrationNames()
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.New()
	for _, name := range names {
		if name > "033_project_repository.sql" {
			continue
		}
		migration, err := files.ReadFile("sql/" + name)
		if err != nil {
			t.Fatal(err)
		}
		hash.Write([]byte(name))
		hash.Write([]byte{0})
		hash.Write(migration)
	}
	if got := fmt.Sprintf("%x", hash.Sum(nil)); got != "948165f69338fbbf49a3b90ea96e8a51006dc918fb457e79e7b56c474f7e8b1f" {
		t.Fatalf("released migrations changed: %s", got)
	}
}
