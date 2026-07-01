ALTER TABLE applications
    ADD COLUMN IF NOT EXISTS github_auto_deploy boolean NOT NULL DEFAULT false;
