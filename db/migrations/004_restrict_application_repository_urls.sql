ALTER TABLE applications
    ADD CONSTRAINT applications_repository_url_github_remote
    CHECK (repository_url IS NULL OR repository_url ~ '^(git@github[.]com:[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+[.]git|https://github[.]com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+([.]git)?)$') NOT VALID;
