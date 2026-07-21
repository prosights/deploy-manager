CREATE UNIQUE INDEX IF NOT EXISTS deployments_one_in_progress_per_application
    ON deployments (application_id)
    WHERE status IN ('queued', 'running');
