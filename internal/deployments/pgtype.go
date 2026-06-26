package deployments

import (
	"deploy-manager/internal/stringutil"

	"github.com/jackc/pgx/v5/pgtype"
)

func pgUUID(value string) (pgtype.UUID, error) {
	return stringutil.PgUUID(value)
}

func uuidString(id pgtype.UUID) string {
	return stringutil.UUIDString(id)
}
