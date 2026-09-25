-- AI fields for M3/M4.

-- Questions the analysis would like Mario to answer (the answers make posts accurate).
ALTER TABLE asset_analyses ADD COLUMN questions TEXT NOT NULL DEFAULT '[]';

-- Suggested shape of an idea and what's still missing to write it accurately.
ALTER TABLE ideas ADD COLUMN format TEXT
  CHECK (format IN ('single', 'thread', 'story_seq', 'carousel', 'reel'));
ALTER TABLE ideas ADD COLUMN platforms TEXT NOT NULL DEFAULT '[]';
ALTER TABLE ideas ADD COLUMN questions TEXT NOT NULL DEFAULT '[]';

CREATE INDEX ideas_status_idx ON ideas (status);
CREATE INDEX idea_sources_asset_idx ON idea_sources (asset_id);
CREATE INDEX ai_runs_created_idx ON ai_runs (created_at);
