package migrations

import (
	"context"
	"embed"
	"fmt"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
)

const migrationLockID int64 = 9021001

//go:embed sql/*.sql
var files embed.FS

type DB interface {
	Begin(context.Context) (pgx.Tx, error)
}

func Run(ctx context.Context, db DB) error {
	names, err := migrationNames()
	if err != nil {
		return err
	}

	for _, name := range names {
		if err := runOne(ctx, db, name); err != nil {
			return err
		}
	}
	return nil
}

func runOne(ctx context.Context, db DB, name string) error {
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, migrationLockSQL()); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
	version text PRIMARY KEY,
	applied_at timestamptz NOT NULL DEFAULT now()
)`); err != nil {
		return err
	}

	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)`, name).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return tx.Commit(ctx)
	}

	sql, err := files.ReadFile("sql/" + name)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, string(sql)); err != nil {
		return fmt.Errorf("apply migration %s: %w", name, err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations (version) VALUES ($1)`, name); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func migrationNames() ([]string, error) {
	entries, err := files.ReadDir("sql")
	if err != nil {
		return nil, err
	}

	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		names = append(names, entry.Name())
	}
	sort.Strings(names)
	return names, nil
}

func migrationLockSQL() string {
	return fmt.Sprintf("SELECT pg_advisory_xact_lock(%d)", migrationLockID)
}
