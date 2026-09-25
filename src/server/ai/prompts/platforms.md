## x

X (Twitter) — technical work, experiments, ideas, opinions. Peers: developers and designers.

- Format `single`: one post, at most 280 characters, usually published with the media attached.
  Format `thread`: 2–6 posts of at most 280 characters each — only when there are real steps or
  details to walk through. No "1/", "🧵" or "A thread" markers.
- Write so the text works with the attached media ("the trail reacts to cursor speed"), not about it
  ("check out this video").
- No hashtags, no emojis. Avoid URLs in the text unless the post is about a link.
- One segment per post. Media is attached to the post separately: set `assetId` and `kind` to null.

## linkedin

LinkedIn (personal profile) — peers, clients and potential collaborators.

- Format `single`: one post, typically 600–1,300 characters, at most 3,000. Only the first ~200
  characters show before "…see more": open with the point itself, not a teaser.
- Short paragraphs of 1–3 sentences separated by blank lines. First person, concrete: what was
  built, how, and why it matters for the work or for clients. Practical value over self-promotion.
- No "excited/thrilled to announce", no engagement bait ("Agree?", "Thoughts?"), no emoji bullets.
  At most 3 hashtags at the very end, and only specific ones (#webgl, not #innovation).
- Exactly one segment. Media is attached to the post separately: set `assetId` and `kind` to null.

## ig_story

Instagram Stories — informal, visual, work in progress.

- Format `story_seq`: 2–6 frames. Each frame is a full-screen 9:16 image or video with its text
  rendered INTO the frame (large type, bottom-left). Stories have no caption.
- Per frame: `text` = the on-screen words (at most ~120 characters, one thought per frame,
  conversational; may be empty for a purely visual frame); `assetId` = the image or video from
  the material to show, or null for a text-only frame on a dark background; `kind` = 'text',
  'image' or 'video' matching the asset.
- A good sequence: what it is → the interesting detail (show it, prefer the recordings for motion) →
  where it's going or the result.
- No hashtags, no "swipe up", no links. At most one emoji in the whole sequence, only if natural.

## ig_feed

Instagram feed carousel — curated, finished visuals: case studies, explorations, results.

- Format `carousel`: 2–10 slides, all 4:5. Per slide: `text` = short on-slide text (at most ~80
  characters, may be empty); `assetId` = the image or video to show, or null for a typographic
  slide; `kind` = 'text', 'image' or 'video'.
- The first slide states the subject (what it is, for whom if public); the last may close or credit.
  Mostly visual slides, with occasional text slides for rhythm.
- `caption`: 1–4 short paragraphs, the first line says what this is; at most 2,200 characters;
  0–5 specific hashtags at the end; @mentions only if they appear in the material.
