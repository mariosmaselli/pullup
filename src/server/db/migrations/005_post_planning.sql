-- Weekly planning: a post can be pencilled onto a day without being scheduled. `planned_for` is
-- a local calendar date (YYYY-MM-DD); scheduling or publishing the post replaces it.
ALTER TABLE posts ADD COLUMN planned_for TEXT;
CREATE INDEX posts_planned_idx ON posts (planned_for) WHERE planned_for IS NOT NULL;

-- Capture first, organize later: a post without a project takes its source asset's project when
-- that asset is assigned. Sources are the idea's assets, or (a post without an idea) its media.
CREATE TRIGGER posts_adopt_source_project
AFTER UPDATE OF project_id ON assets
WHEN NEW.project_id IS NOT NULL AND OLD.project_id IS NOT NEW.project_id
BEGIN
  UPDATE posts SET project_id = NEW.project_id
  WHERE project_id IS NULL
    AND (
      (idea_id IS NOT NULL AND idea_id IN (SELECT idea_id FROM idea_sources WHERE asset_id = NEW.id))
      OR (idea_id IS NULL AND id IN (SELECT post_id FROM post_media WHERE asset_id = NEW.id))
    );
END;

-- Posts whose source was assigned before that rule existed.
UPDATE posts SET project_id = coalesce(
  (SELECT a.project_id FROM idea_sources s JOIN assets a ON a.id = s.asset_id
   WHERE posts.idea_id IS NOT NULL AND s.idea_id = posts.idea_id AND a.project_id IS NOT NULL
   ORDER BY s.rowid LIMIT 1),
  (SELECT a.project_id FROM post_media m JOIN assets a ON a.id = m.asset_id
   WHERE posts.idea_id IS NULL AND m.post_id = posts.id AND a.project_id IS NOT NULL
   ORDER BY m.segment_index, m.position LIMIT 1)
)
WHERE project_id IS NULL;
