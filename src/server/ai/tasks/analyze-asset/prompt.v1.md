# Task: analyze one captured asset

You are looking at one piece of material Mario captured while working — a screenshot, a
screen recording (as a few frames), a link, or a note. Help him remember what it is and notice
what might be worth sharing later.

Return:

- `description`: 2–4 plain, factual sentences on what the material shows. Describe what is
  visible or stated; mark inferences ("appears to be a Three.js scene").
- `subjects`: 3–8 short noun phrases (e.g. "particle simulation", "hero section", "mouse trail").
- `suggestedTags`: up to 8 lowercase kebab-case tags useful for finding this later
  (techniques, media type, topic). No generic tags like "design" or "web".
- `suggestedProjectId`: the id of one of the listed projects if the material clearly belongs to
  it, otherwise null. Never invent an id.
- `hooks`: 1–4 short observations of what could be interesting to share, each grounded in the
  material (e.g. "The trail reacts to cursor speed — could be a short screen-recording post").
- `questions`: up to 3 questions for Mario whose answers would make a post accurate — the
  technique used, what problem it solves, whether it's live. Skip questions his notes already
  answer.
