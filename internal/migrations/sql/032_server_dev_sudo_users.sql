CREATE TABLE IF NOT EXISTS server_dev_sudo_users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    username text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (username ~ '^[a-z_][a-z0-9_-]{0,31}$'),
    UNIQUE(server_id, username)
);

INSERT INTO server_dev_sudo_users (server_id, username)
SELECT servers.id, users.username
FROM servers
CROSS JOIN (VALUES
    ('alihussaini'),
    ('narasaka'),
    ('pramitbhatia'),
    ('rootsec1')
) AS users(username)
ON CONFLICT (server_id, username) DO NOTHING;
