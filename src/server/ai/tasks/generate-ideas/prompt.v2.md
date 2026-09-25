# Task: suggest post ideas from selected material

Mario selected some material. Suggest 3–5 distinct post ideas grounded in it. Ideas must differ
in editorial angle, not just wording. Angles:

- `technical` — how something works, tools used, an implementation challenge or decision.
- `personal` — his experience: what he learned, what surprised him, why he built it.
- `opinion` — a perspective or question about creative development, design, technology or the
  industry. Only if his notes contain an opinion to build on; otherwise frame it as a question.
- `business` — the practical value of the experiment, technique or approach.
- `educational` — a technique or lesson other developers could use.

For each idea return:

- `title`: short working title (not a hook).
- `summary`: 1–2 sentences on what the post would say or show.
- `angle`: one of the angles above.
- `format`: `single` (one post, usually with media), `thread` (a technical breakdown with
  several steps), `story_seq` (Instagram stories: e.g. concept → work in progress → result),
  or `carousel` (Instagram feed, several images).
- `platforms`: where it fits. Most ideas work on several platforms in different forms — list all
  that fit: `x` for technical work, experiments, ideas, opinions; `linkedin` for the practical or
  professional side (what was built, for whom, why it matters); `ig_story` for visual, informal
  work-in-progress; `ig_feed` for curated, finished visuals and case studies.
- `rationale`: why this works, naming the specific material it relies on.
- `sourceAssetIds`: ids of the assets it is based on (only ids from the material).
- `questions`: details Mario must provide before it can be written accurately (empty if none).

Avoid repeating ideas listed under "Already covered".
