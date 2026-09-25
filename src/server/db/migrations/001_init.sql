-- Pullup initial schema.
-- Conventions: TEXT uuid ids, ISO-8601 UTC timestamps as TEXT, booleans as INTEGER 0/1,
-- lists/objects as JSON TEXT. File paths are relative to the library root.
-- Enum CHECK values mirror src/shared/constants.ts.

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Content identities (Mario, Nonlinear Studio).
CREATE TABLE profiles (
  id             TEXT PRIMARY KEY,
  slug           TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  voice_guide    TEXT NOT NULL DEFAULT '',
  platform_prefs TEXT NOT NULL DEFAULT '{}',
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE projects (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  slug               TEXT NOT NULL UNIQUE,
  description        TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'paused', 'done', 'archived')),
  is_client_work     INTEGER NOT NULL DEFAULT 0,
  -- Whether assets of this project may be sent to the AI provider. Off by default for client work.
  ai_allowed         INTEGER NOT NULL DEFAULT 1,
  tags               TEXT NOT NULL DEFAULT '[]',
  default_profile_id TEXT REFERENCES profiles (id) ON DELETE SET NULL,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Everything captured. project_id NULL = unassigned; triaged_at NULL = still in the Inbox.
CREATE TABLE assets (
  id                TEXT PRIMARY KEY,
  kind              TEXT NOT NULL CHECK (kind IN ('image', 'video', 'link', 'note')),
  title             TEXT NOT NULL DEFAULT '',
  notes             TEXT NOT NULL DEFAULT '',
  source            TEXT NOT NULL
                    CHECK (source IN ('drop', 'paste', 'inbox_folder', 'url', 'note', 'shortcut')),
  project_id        TEXT REFERENCES projects (id) ON DELETE SET NULL,
  tags              TEXT NOT NULL DEFAULT '[]',
  visibility        TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'approved')),
  processing_status TEXT NOT NULL DEFAULT 'pending'
                    CHECK (processing_status IN ('pending', 'processing', 'ready', 'failed')),
  processing_error  TEXT,
  triaged_at        TEXT,
  captured_at       TEXT NOT NULL,
  -- files (image / video)
  file_path         TEXT,
  original_name     TEXT,
  mime              TEXT,
  size_bytes        INTEGER,
  checksum          TEXT,
  width             INTEGER,
  height            INTEGER,
  duration_ms       INTEGER,
  -- links
  url               TEXT,
  url_meta          TEXT,
  -- notes
  body              TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX assets_checksum_uq ON assets (checksum) WHERE checksum IS NOT NULL;
CREATE INDEX assets_project_idx ON assets (project_id);
CREATE INDEX assets_inbox_idx ON assets (captured_at) WHERE triaged_at IS NULL;

-- Generated files (thumbnails, video frames, link images). Rebuildable, live in cache/.
CREATE TABLE asset_derivatives (
  id         TEXT PRIMARY KEY,
  asset_id   TEXT NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('thumb', 'poster', 'frame', 'og_image')),
  file_path  TEXT NOT NULL,
  width      INTEGER,
  height     INTEGER,
  time_ms    INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX asset_derivatives_asset_idx ON asset_derivatives (asset_id);

-- Every AI call: cost tracking, prompt versioning and source traceability.
CREATE TABLE ai_runs (
  id             TEXT PRIMARY KEY,
  task           TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  provider       TEXT NOT NULL,
  model          TEXT NOT NULL,
  input_refs     TEXT NOT NULL DEFAULT '{}',
  output         TEXT,
  tokens_in      INTEGER,
  tokens_out     INTEGER,
  cost_usd       REAL,
  duration_ms    INTEGER,
  error          TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- AI suggestions, stored apart from the metadata you entered yourself.
CREATE TABLE asset_analyses (
  id                   TEXT PRIMARY KEY,
  asset_id             TEXT NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  ai_run_id            TEXT REFERENCES ai_runs (id) ON DELETE SET NULL,
  description          TEXT NOT NULL DEFAULT '',
  subjects             TEXT NOT NULL DEFAULT '[]',
  suggested_tags       TEXT NOT NULL DEFAULT '[]',
  suggested_project_id TEXT REFERENCES projects (id) ON DELETE SET NULL,
  hooks                TEXT NOT NULL DEFAULT '[]',
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX asset_analyses_asset_idx ON asset_analyses (asset_id);

CREATE TABLE collections (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  project_id  TEXT REFERENCES projects (id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE collection_assets (
  collection_id TEXT NOT NULL REFERENCES collections (id) ON DELETE CASCADE,
  asset_id      TEXT NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, asset_id)
);

CREATE TABLE ideas (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  summary    TEXT NOT NULL DEFAULT '',
  angle      TEXT CHECK (angle IN ('technical', 'personal', 'opinion', 'business', 'educational')),
  rationale  TEXT NOT NULL DEFAULT '',
  origin     TEXT NOT NULL CHECK (origin IN ('discovery', 'manual', 'asset')),
  status     TEXT NOT NULL DEFAULT 'suggested'
             CHECK (status IN ('suggested', 'saved', 'dismissed', 'drafted')),
  profile_id TEXT REFERENCES profiles (id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects (id) ON DELETE SET NULL,
  ai_run_id  TEXT REFERENCES ai_runs (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Which assets an idea is based on.
CREATE TABLE idea_sources (
  idea_id  TEXT NOT NULL REFERENCES ideas (id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  note     TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (idea_id, asset_id)
);

-- One platform-specific piece of content, from draft to published.
-- Replaces separate drafts / scheduled / published tables: it is scheduled once and published once.
CREATE TABLE posts (
  id                  TEXT PRIMARY KEY,
  idea_id             TEXT REFERENCES ideas (id) ON DELETE SET NULL,
  profile_id          TEXT NOT NULL REFERENCES profiles (id),
  project_id          TEXT REFERENCES projects (id) ON DELETE SET NULL,
  platform            TEXT NOT NULL CHECK (platform IN ('x', 'ig_story', 'ig_feed')),
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

CREATE INDEX posts_status_idx ON posts (status);
CREATE INDEX posts_scheduled_idx ON posts (scheduled_for) WHERE scheduled_for IS NOT NULL;
CREATE INDEX posts_project_idx ON posts (project_id);

-- Full text history. segments = [{ text }] — one per thread post / story frame / carousel slide.
-- claims = [{ text, basis: 'source' | 'framing' | 'unconfirmed', assetId? }], questions = [string].
CREATE TABLE post_revisions (
  id          TEXT PRIMARY KEY,
  post_id     TEXT NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  segments    TEXT NOT NULL DEFAULT '[]',
  author      TEXT NOT NULL CHECK (author IN ('ai', 'me')),
  instruction TEXT,
  claims      TEXT NOT NULL DEFAULT '[]',
  questions   TEXT NOT NULL DEFAULT '[]',
  ai_run_id   TEXT REFERENCES ai_runs (id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX post_revisions_post_idx ON post_revisions (post_id);

-- Media attached to a post, per segment. Assets are referenced, never copied.
CREATE TABLE post_media (
  post_id       TEXT NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  asset_id      TEXT NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  segment_index INTEGER NOT NULL DEFAULT 0,
  position      INTEGER NOT NULL DEFAULT 0,
  crop          TEXT,
  PRIMARY KEY (post_id, asset_id, segment_index)
);

CREATE INDEX post_media_asset_idx ON post_media (asset_id);

INSERT INTO profiles (id, slug, name, voice_guide) VALUES
  (
    '00000000-0000-4000-8000-000000000001',
    'mario',
    'Mario Sanchez Maselli',
    'Creative developer in Tallinn. Concise, natural, specific. Shares real work: experiments, technical solutions, opinions. No exaggerated enthusiasm, motivational language, artificial hooks, unnecessary emojis or marketing polish.'
  ),
  (
    '00000000-0000-4000-8000-000000000002',
    'nonlinear',
    'Nonlinear Studio',
    'Creative development studio. Finished projects, case studies and the practical value of the work. Clear and confident, never salesy. Credits collaborators and respects client confidentiality.'
  );
