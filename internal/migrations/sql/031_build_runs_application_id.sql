ALTER TABLE build_runs
ADD COLUMN IF NOT EXISTS application_id uuid REFERENCES applications(id) ON DELETE SET NULL;
