-- migrate:foreign-keys-off
-- Template renders, and a 'proxy' derivative for videos (constant frame rate, frequent keyframes,
-- BT.709 — what the template engine decodes frame by frame).

CREATE TABLE asset_derivatives_new (
  id         TEXT PRIMARY KEY,
  asset_id   TEXT NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('thumb', 'poster', 'frame', 'og_image', 'proxy')),
  file_path  TEXT NOT NULL,
  width      INTEGER,
  height     INTEGER,
  time_ms    INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO asset_derivatives_new (id, asset_id, role, file_path, width, height, time_ms, created_at)
SELECT id, asset_id, role, file_path, width, height, time_ms, created_at FROM asset_derivatives;

DROP TABLE asset_derivatives;
ALTER TABLE asset_derivatives_new RENAME TO asset_derivatives;
CREATE INDEX asset_derivatives_asset_idx ON asset_derivatives (asset_id);

-- One rendered file (MP4 or JPEG) made by a template from some assets, text and params.
-- Renders are outputs, not captures: they live in media/renders/ and never appear in the Library.
CREATE TABLE renders (
  id               TEXT PRIMARY KEY,
  template_id      TEXT NOT NULL,
  template_version INTEGER NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('video', 'image')),
  aspect           TEXT NOT NULL,
  width            INTEGER NOT NULL,
  height           INTEGER NOT NULL,
  fps              INTEGER,
  duration_ms      INTEGER,
  -- Everything needed to reproduce it: asset ids, text, params, seed.
  inputs           TEXT NOT NULL DEFAULT '{}',
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed')),
  error            TEXT,
  -- Checks against platform specs that didn't pass (warnings, not failures).
  warnings         TEXT NOT NULL DEFAULT '[]',
  file_path        TEXT,
  poster_path      TEXT,
  size_bytes       INTEGER,
  encoder          TEXT,
  elapsed_ms       INTEGER,
  -- Optional link to the Instagram frame/slide it was made for.
  post_id          TEXT REFERENCES posts (id) ON DELETE SET NULL,
  segment_index    INTEGER,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX renders_post_idx ON renders (post_id, segment_index);
CREATE INDEX renders_created_idx ON renders (created_at);
