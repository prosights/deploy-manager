ALTER TABLE deployments
    ADD CONSTRAINT deployments_queued_has_no_runtime_timestamps
    CHECK ((status = 'queued' AND started_at IS NULL AND finished_at IS NULL) OR status <> 'queued') NOT VALID;

ALTER TABLE deployments
    ADD CONSTRAINT deployments_running_has_started_timestamp
    CHECK ((status = 'running' AND started_at IS NOT NULL AND finished_at IS NULL) OR status <> 'running') NOT VALID;

ALTER TABLE deployments
    ADD CONSTRAINT deployments_terminal_has_finished_timestamp
    CHECK ((status IN ('succeeded', 'failed', 'cancelled') AND finished_at IS NOT NULL) OR status NOT IN ('succeeded', 'failed', 'cancelled')) NOT VALID;
