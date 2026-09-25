-- migrate:foreign-keys-off
-- LinkedIn joins X and Instagram as a platform, and Instagram feed posts get a caption.
-- SQLite can't change a CHECK constraint, so `posts` is rebuilt (the standard 12-step procedure:
-- foreign keys are off for this file and verified by the runner afterwards).

CREATE TABLE posts_new (
  id                  TEXT PRIMARY KEY,
  idea_id             TEXT REFERENCES ideas (id) ON DELETE SET NULL,
  profile_id          TEXT NOT NULL REFERENCES profiles (id),
  project_id          TEXT REFERENCES projects (id) ON DELETE SET NULL,
  platform            TEXT NOT NULL CHECK (platform IN ('x', 'linkedin', 'ig_story', 'ig_feed')),
  format              TEXT NOT NULL
                      CHECK (format IN ('single', 'thread', 'story_seq', 'carousel', 'reel')),
  angle               TEXT CHECK (angle IN ('technical', 'personal', 'opinion', 'business', 'educational')),
  status              TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'review', 'approved', 'scheduled', 'published', 'archived', 'discarded')),
  current_revision_id TEXT,
  scheduled_for       TEXT,
  published_at        TEXT,
  public_url          TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO posts_new (id, idea_id, profile_id, project_id, platform, format, angle, status,
  current_revision_id, scheduled_for, published_at, public_url, created_at, updated_at)
SELECT id, idea_id, profile_id, project_id, platform, format, angle, status,
  current_revision_id, scheduled_for, published_at, public_url, created_at, updated_at
FROM posts;

DROP TABLE posts;
ALTER TABLE posts_new RENAME TO posts;

CREATE INDEX posts_status_idx ON posts (status);
CREATE INDEX posts_scheduled_idx ON posts (scheduled_for) WHERE scheduled_for IS NOT NULL;
CREATE INDEX posts_project_idx ON posts (project_id);
CREATE INDEX posts_idea_idx ON posts (idea_id);

-- Instagram feed posts have a caption next to their slides. Stories ignore captions, so their
-- text lives in the segments (rendered into the frames).
ALTER TABLE post_revisions ADD COLUMN caption TEXT;
