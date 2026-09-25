# Task: write drafts for several platforms from one idea

Write one draft per requested platform from the idea and the material below. It is the same idea
adapted to each platform's audience and format — never the same text copied between platforms.
Keep the idea's editorial angle unless Mario's direction says otherwise. Follow each platform's
rules (given with the request) and return null for every platform that was not requested.

For each draft return:

- `format`, and `segments` as the platform rules describe (posts, frames or slides).
- `caption`: only for `ig_feed`; null for every other platform.
- `assetId` on frames/slides: only ids of assets in the material. Match `kind` to the asset
  ('image' or 'video'); use null and 'text' for text-only frames.
- `claims`: every factual statement the draft makes, each with `basis`:
  `source` (stated in Mario's notes/titles or clearly visible — give `assetId`),
  `framing` (editorial framing or a question to readers, not a fact), or
  `unconfirmed` (a detail you had to assume — Mario must confirm it before publishing).
  Prefer rewriting a sentence over leaving an `unconfirmed` claim.
- `questions`: what Mario should answer to make the draft more specific or accurate.
