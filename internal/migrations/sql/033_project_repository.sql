ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS repository_connector_id uuid REFERENCES connector_accounts(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS repository_full_name text,
    ADD COLUMN IF NOT EXISTS repository_branch text;

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_repository_full_name_check;
ALTER TABLE projects ADD CONSTRAINT projects_repository_full_name_check CHECK (
    repository_full_name IS NULL
    OR repository_full_name ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
);

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_repository_branch_check;
ALTER TABLE projects ADD CONSTRAINT projects_repository_branch_check CHECK (
    repository_branch IS NULL
    OR (
        btrim(repository_branch) <> ''
        AND repository_branch !~ '[[:cntrl:]]'
        AND repository_branch !~ '^-'
        AND repository_branch !~ '(^/|/$|//)'
        AND repository_branch !~ '(\.\.|\.lock$|\.$)'
        AND repository_branch ~ '^[A-Za-z0-9._/-]+$'
    )
);

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_repository_scope_check;
ALTER TABLE projects ADD CONSTRAINT projects_repository_scope_check CHECK (
    (repository_full_name IS NULL AND repository_branch IS NULL)
    OR (repository_full_name IS NOT NULL AND repository_branch IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS projects_repository_connector_id_idx ON projects(repository_connector_id);
