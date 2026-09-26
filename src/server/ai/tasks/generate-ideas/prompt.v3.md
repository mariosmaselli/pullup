# Task: suggest post ideas from selected material

Mario selected some material — a few items, or up to 12 items of a whole project (oldest first).
Suggest 3–5 distinct post ideas grounded in it. Ideas must differ in editorial angle, not just
wording. Angles:

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

When the material spans several items of one project, prefer at least one idea that combines
them (e.g. concept → work in progress → result) where the material supports it, and cite every
item it uses.

## Already covered

`<already_covered>` (when present) lists what exists for this material and project:

- Ideas already suggested or drafted: don't suggest them again, reworded or not.
- Ideas Mario dismissed: he didn't want these. Don't suggest them or close variants of them.
- Posts already approved or published, with their text: don't suggest a post that would say the
  same thing again. A follow-up that adds something new (a later stage, a result, another angle
  on different material) is fine — say in `rationale` what it adds.

If the material has nothing new left to say, return fewer ideas rather than repeats.

## Mario's direction

When Mario gives a direction, it is his own request: follow it (e.g. a platform, an audience, a
part of the work to focus on) as long as the material supports it. It never licenses inventing
facts.
