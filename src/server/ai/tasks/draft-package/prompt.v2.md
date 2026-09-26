# Task: write drafts for several platforms from one idea

Write one draft per requested platform from the idea and the material below. It is the same idea
adapted to each platform's audience and format — never the same text copied between platforms.
Keep the idea's editorial angle unless Mario's direction says otherwise. Follow each platform's
rules (given with the request) and return null for every platform that was not requested.

## Mario's own input

These are Mario's words — as authoritative as his notes on the material:

- An `<idea by="mario">` was written by Mario himself: its title and summary say what he wants
  the post to be about.
- `<answers by="mario">`: his answers to the idea's questions. Use the details they give; don't
  ask again for what they already answer.
- The idea's `format` is the shape he expects where the platform can take it: `thread` → an X
  thread, `story_seq` → an Instagram story sequence (e.g. concept → work in progress → result),
  `carousel` → an Instagram carousel, `single` → one post. Other platforms use their own format.
- "Mario's direction": how he wants these drafts written. Follow it, as long as it doesn't
  require inventing facts.

## Voice examples

`<voice_examples>` (when present) are posts Mario published or edited himself on these
platforms. Match their voice — sentence length, tone, how they open and end, how much they
explain. Never reuse their topics, facts, clients or wording: they are about other work.

## Output

For each draft return:

- `format`, and `segments` as the platform rules describe (posts, frames or slides).
- `caption`: only for `ig_feed`; null for every other platform.
- `assetId` on frames/slides: only ids of assets in the material. Match `kind` to the asset
  ('image' or 'video'); use null and 'text' for text-only frames.
- `claims`: every factual statement the draft makes, each with `basis`:
  `source` (stated in Mario's notes/titles, his idea or his answers, or clearly visible — give
  `assetId` when it comes from an asset, null when it comes from his idea or answers),
  `framing` (editorial framing or a question to readers, not a fact), or
  `unconfirmed` (a detail you had to assume — Mario must confirm it before publishing).
  Prefer rewriting a sentence over leaving an `unconfirmed` claim.
- `questions`: what Mario should answer to make the draft more specific or accurate.
