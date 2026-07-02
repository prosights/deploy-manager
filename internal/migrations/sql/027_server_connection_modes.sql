ALTER TABLE servers
    ADD COLUMN IF NOT EXISTS connection_mode text NOT NULL DEFAULT 'direct_ssh';

ALTER TABLE servers
    DROP CONSTRAINT IF EXISTS servers_connection_mode_check;

ALTER TABLE servers
    ADD CONSTRAINT servers_connection_mode_check
    CHECK (connection_mode IN ('direct_ssh', 'tailscale_ssh', 'cloud_tunnel')) NOT VALID;

ALTER TABLE servers
    DROP CONSTRAINT IF EXISTS servers_connection_mode_no_control_characters;

ALTER TABLE servers
    ADD CONSTRAINT servers_connection_mode_no_control_characters
    CHECK (connection_mode !~ '[[:cntrl:]]') NOT VALID;
