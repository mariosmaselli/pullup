# Templates

Each folder here is one template: something Pullup renders into a story frame, a carousel slide
or a short video. Templates run in a Web Worker on an `OffscreenCanvas` and are exported
frame-by-frame, so a 6 s 1080×1920 WebGL video renders in about a second.

```
templates/
  _lib/            shared helpers (base layer, layout options, backgrounds, text, Three.js) — not a template
  my-template/
    meta.ts        export const meta: TemplateMeta   ← name, formats, inputs, fonts
    index.ts       export default (ctx) => ({ setup, update, render, dispose })
```

New folders show up in **Templates** automatically (Vite picks them up; no registration).
The full contract with comments is in [`src/shared/template.ts`](../src/shared/template.ts).
Look at [`default`](default) first — the base layer over a background and one optional image or
clip, canvas 2D, a still or a video depending on its settings — then [`media-grid`](media-grid)
(three.js, many media, the base layer as an overlay).

`default` replaced `text-story`, `text-reveal`, `image-caption` and `video-caption` (and the
`_lib/caption.ts` card the last two shared); they are in git history, and builder frames saved
with them open as Default with their settings carried over (`upgradeTemplate` in
[`src/client/lib/frame-templates.ts`](../src/client/lib/frame-templates.ts)).
Also kept in git history, removed because they didn't meet Mario's bar (useful as code references,
not as designs): `slow-zoom`, `case-study-cover`, `planes-3d` (commit 4bfcd7c) and
`crossfade-slideshow`, `shader-transition` (Three.js multi-clip transitions, video decode in a
custom shader), `device-frame` (3D device scene) — commit 2d3c978.

## Still, video or both: `kind`

`meta.kind` is `'still'` (a JPEG: one frame at t = 0), `'video'` (an MP4) or `'auto'`: the
template decides per render with `meta.outputKind(inputs)` → `'still' | 'video'`, from the kinds
of the media and background and the text and params (defaults filled in). Keep it pure and cheap —
it runs on the main thread on every settings change. The engine, the render record, the output
checks, the studio (Render JPEG / MP4, transport, duration) and the builder (duration, "· video",
the zip) all use the resolved kind; read it with `resolveOutputKind(meta, inputs)`
(`src/shared/template.ts`), never from `meta.kind`. Inside the template it is `ctx.kind`; a still
has `ctx.duration = 0` — draw the settled state. `'auto'` templates declare `fps` and `duration`
like videos. Functions don't cross to the worker: Pullup posts `metaData(meta)` and the kind.

The base layer's `baseOutputKind` is a still when nothing moves: no video media or background,
and no type animation (or no type).

## The base layer: caption, corner labels, legibility

[`_lib/base.ts`](_lib/base.ts) is the type every template shares — a caption in Mario's story type
and four one-line corner labels — laid out, animated and drawn one way, with the legibility
gradient only where that type sits over media. At its defaults (no labels, animation None) it is
the old `text-story` pixel for pixel; `animation: 'Reveal'` + `exit: 'Rise'` is the old
`text-reveal`'s motion frame for frame.

```ts
// meta.ts
kind: 'auto', outputKind: baseOutputKind, fonts: BASE_FONTS,
text: TEXT_FIELDS,                                   // caption (first: the builder's frame text) + 4 labels
params: { ...MEDIA_PARAMS, ...TEXT_PARAMS, ...SCRIM_PARAMS, ...BACKGROUND_PARAMS },

// index.ts (canvas 2D)
setup():  background = createBackground2D(ctx); media = await createMedia2D(ctx); base = await createBase(ctx)
update(t): media.update(t); if (!media.hidesGround) background.update(t); base.update(t)
render(): background.draw(g); media.draw(g); base.draw(g, media.rect)
```

(`background.draw` still paints the ground colour under a covering clip until its first frame is
decoded; only the background video's decoding is skipped, by not seeking it.)

| Export                                                                                         | What                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TEXT_FIELDS` = `CAPTION_FIELD` + `LABEL_FIELDS`                                               | `caption` (multiline, `*accent*`), `labelTopLeft`, `labelTopRight`, `labelBottomLeft`, `labelBottomRight` (one line, 40, optional, empty by default); `LABEL_KEYS`                                                                                                                                            |
| `TEXT_PARAMS`                                                                                  | `textColor` #ffffff, `textSize` 48–160 (84), `weight` Regular/Medium, `textPosition` Top/Middle/Bottom, `textAlign` Left/Center, `accent` #ff5b2e, `animation` None/Fade/Rise/Reveal (None), `revealBy` Words/Lines (shown with Reveal), `exit` None/Fade/Rise (None)                                         |
| `MEDIA_PARAMS`                                                                                 | `size` Fill/Fit, `scale`, `focusX`, `focusY` — `MEDIA_SIZE_PARAMS`, shown once there is media                                                                                                                                                                                                                 |
| `SCRIM_PARAMS`                                                                                 | `gradient` 0–1 (0.55): the legibility gradient's strength (shown with media)                                                                                                                                                                                                                                  |
| `textSettings(params)`                                                                         | the values above, read tolerantly                                                                                                                                                                                                                                                                             |
| `createBase(ctx, { captionKey?, margins? })`                                                   | → `BaseLayer`: `update(t)`, `draw(g, mediaRect)`, `drawScrim(g, rect \| null)`, `drawType(g, rect \| LabelGround?)`, `caption` / `labels` / `edges` (ink boxes, for framing content clear of the type), `scrims` (bands, with each piece of type's ink) + `tint` + `scrimLevel()` (for shaders), `stateKey()` |
| `createMedia2D(ctx, i = 0)`                                                                    | the media sized by `MEDIA_PARAMS`: `rect`, `covers`, `hidesGround`, `update(t)`, `draw(g)`                                                                                                                                                                                                                    |
| `createBaseOverlay(ctx, base, { scrim, labels })` ([`_lib/base-three.ts`](_lib/base-three.ts)) | three.js: the layer on a transparent canvas texture, redrawn when it moves, drawn over the frame with `overlay.render(renderer)`; `scrim: 'frame' \| rect \| null`; `labels`: a `LabelGround` (how much picture is under each label this frame)                                                               |

Layout: margins from `FRAME_MARGINS` (`_lib/layout.ts`: 160 px top/bottom on stories, 40 px
elsewhere, 40 px sides). Caption line boxes sit on the margins (text-story); top labels' cap tops
sit on the top margin, bottom labels' baselines on the bottom margin; with labels on an edge the
caption keeps 56 px of ink clear of them and shrinks (×0.95, down to 32 px) if it must. A left and
right label that would meet are shortened with an ellipsis. On 16:9 the caption measure is capped
at 1240 px and its lines are balanced (the measure narrows while the line count holds, until each
paragraph's last line is ≥ 45% of its longest); other formats keep text-story's breaks. Motion: Fade — lines fade in (0.3 s, 80 ms apart); Rise — lines drift up 0.4 line as
they fade in; Reveal — words or lines rise out of per-line masks (text-reveal's timing); the
labels come in with the first line. Exit Rise — lines leave through the top of their masks
(labels first); Fade — everything fades. The exit ends 0.25 s before the last frame. The gradient
(tinted dark under light type, off-white under dark) is clipped to the media rect, skipped where
the type isn't over the media, and fades in and out with the type. Labels get the caption's
strength, held from the frame's edge through their ink (small type needs the most contrast: at
0.55 a white page goes to #7c7c7c, ≈ 4.2:1 under white). Bands whose fades run into each other (a
Middle caption between labels on a square) are drawn as one, held between them, not as stripes.
Labels are the text colour at 60% on a plain ground and solid over a picture (the media rect
passed to `draw` / `drawType`, a `LabelGround` — the grid's cells under them — or a background
image / video; `drawType(g)` alone: solid whenever there is media) — 60% white over a photo turns
muddy. Accents: `_lib/accent.ts`.

## Shared options: media size and text position

Every template that shows media full frame or sets type offers the same controls, from
[`_lib/layout.ts`](_lib/layout.ts) — spread them into `meta.params` so the keys, labels and
defaults match everywhere (don't invent a template-specific "crop" or "framing" param for this):

```ts
params: { ...MEDIA_SIZE_PARAMS, ...TEXT_POSITION_PARAMS, color: { … } }
```

| Group                  | Key            | Control                                    | Default   |
| ---------------------- | -------------- | ------------------------------------------ | --------- |
| `MEDIA_SIZE_PARAMS`    | `size`         | Media size: `Fill` (cover) / `Fit` (whole) | `Fill`    |
|                        | `scale`        | Scale 0.5–2, multiplies either             | 1         |
|                        | `focusX`       | Position left–right 0–1                    | 0.5       |
|                        | `focusY`       | Position top–bottom 0–1                    | 0.5       |
|                        | `background`   | Ground colour around Fit / scaled media    | `#101010` |
| `TEXT_POSITION_PARAMS` | `textPosition` | `Top` / `Middle` / `Bottom`                | `Bottom`  |
|                        | `textAlign`    | `Left` / `Center`                          | `Left`    |

Position works both ways: when the media overflows the frame it picks which part shows (0 = its
left/top edge visible); when there's room to spare it places the media (0 = against the left/top
edge). The defaults reproduce the classic look — media covering the frame, centred; type
bottom-left on the story margins.

Every new option reduces to the previous look at its default.

A param can say when its control shows — `when: { param: 'animation', is: ['Reveal'] }` or
`when: { media: true }` (both must hold if both are set) — so the studio and a frame's Options
only list controls that do something. The value still applies when hidden. Data only (`meta` is
posted to the worker); `paramVisible(spec, { params, media })` in `src/shared/template.ts`.

Text fields: in the builder the first field is the frame's own text; the others (the labels)
are edited in the frame's Options, stored on the frame as `template.text`, start empty and never
take the field's `default` (that is sample copy for the Templates studio).

Helpers (all in canvas px):

- `mediaSize(ctx.params)` / `textPlacement(ctx.params)` — read the values, tolerating missing or
  stale ones (anything but `'Fit'` is Fill).
- `mediaRect(frameW, frameH, mediaW, mediaH, { size, scale, focusX, focusY })` → `{ x, y, w, h }`,
  the destination rect relative to the frame. It may extend past the frame: clip, and fill the
  ground first. Canvas 2D: `drawImage(source, x, y, w, h)`; WebGL: derive the UV scale/offset.
- `textBlockY(frameH, blockH, position, { top, bottom })` → top y of a text block (Middle centres
  on the frame, kept inside the margins).
- `textLineX(frameW, lineW, align, side)` → x of one line (`ctx.layoutText` lines carry `width`).

Share code between templates through `_lib/`, never by importing another template's folder.

## Backgrounds: colour, image or video

The ground behind everything a template draws is a colour or an image / video from the library.
Opt in by spreading `BACKGROUND_PARAMS` from [`_lib/background.ts`](_lib/background.ts) into
`meta.params` — Pullup then shows the **Background** picker for the template (Templates studio,
and a frame's Options in the builder) — and draw the background first:

```ts
params: { ...MEDIA_SIZE_PARAMS, ...TEXT_POSITION_PARAMS, ...BACKGROUND_PARAMS, color: { … } }
```

| Key                | Control                                                 | Default   |
| ------------------ | ------------------------------------------------------- | --------- |
| `background`       | Colour (the same key as in `MEDIA_SIZE_PARAMS`)         | `#101010` |
| `backgroundFit`    | `Fill` (cover) / `Fit` (whole), like Media size         | `Fill`    |
| `backgroundScale`  | 0.5–2, multiplies either                                | 1         |
| `backgroundX`/`Y`  | Position 0–1, like `focusX`/`focusY`                    | 0.5       |
| `backgroundDarken` | 0–1: black over the image/video (never over the colour) | 0         |
| `backgroundBlur`   | 0–40 design px, Gaussian sigma                          | 0         |

The chosen image/video arrives as `inputs.background` (a `MediaInput`, stored with the render)
and, loaded before `setup()`, as `ctx.background`: `{ kind, width, height, image?, video? }` or
`null` — an upright sRGB `ImageBitmap` (Pullup closes it) or a `VideoLayer`. Don't draw it by
hand; the helpers place it with `mediaRect`, clamp its edges under the blur (no dark rim), darken
and blur it the same way everywhere:

```ts
// canvas 2D — setup():
background = createBackground2D(ctx)
// update(t):  background.update(t)       render():  background.draw(g)   // paints the whole frame
// dispose():  background.dispose()

// three.js — setup() (async: it loads three.js and uploads the first frame):
background = await createBackgroundThree(ctx, renderer)
scene.add(background.mesh) // clip-space quad, drawn first and behind everything, any camera
// update(t):  background.update(t)       render():  background.sync(); renderer.render(scene, camera)
// dispose():  background.dispose()
// (or background.render() alone, then your scene with renderer.autoClear = false)
```

- **Video backgrounds hold their last frame** past the clip's end, like media (a loop would cut
  visibly mid-reel). `update(t)` seeks them; skip it — and skip drawing the background — when
  something opaque covers the frame, so the clip isn't decoded for nothing (`default` skips
  `update` under a full-bleed clip — `media.hidesGround`).
- The three.js background is painted by the same canvas code and uploaded as an sRGB texture:
  the look is identical to the 2D one and there is no colour handling to do (its material already
  ends with `<colorspace_fragment>`; nothing to decode by hand).
- The blur works at reduced resolution on its own canvases: it's cheap (≈1 ms per video frame at
  1080×1920) and a render with the same inputs decodes to identical frames every time.
- `takesBackground(meta)` tells the UI whether a template opted in; `BACKGROUND_MEDIA_KEYS` are
  the settings shown once an image/video is chosen. With no image/video the colour is drawn
  exactly as before, so adding backgrounds never changes an existing look.
- In the builder the choice is kept on the frame (`template.background = { assetId }`), counts as
  the frame's media for privacy (a private background blocks approval like private slides), and
  changing it outdates the frame's render.

## The lifecycle

|                    | When        | Do                                                                                                                                                                                                                                |
| ------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setup()`          | once        | Create the renderer / 2D context, load textures (`await ctx.image(i)`), wire video textures (`ctx.video(i)`), load fonts (`ctx.font`), lay out text (`ctx.layoutText`), build GSAP timelines (`ctx.timeline()`), compile shaders. |
| `update(t, frame)` | every frame | Set uniforms/positions from `t` and from values your timelines tween. Request video frames: `ctx.video(i).seek(localTime)`.                                                                                                       |
| `render()`         | every frame | Draw. Synchronous — no `await`. For video textures call `sync()` first (see `_lib/three.ts`).                                                                                                                                     |
| `dispose()`        | once        | Free GPU resources.                                                                                                                                                                                                               |

"Once" per instance: the live preview sets up a **new instance on every settings change** (each
step of a slider drag), on a fresh canvas, while the previous one keeps drawing until the new one
has drawn. Keep `setup()` quick and free everything in `dispose()`; `ctx.image(i)` hands each
instance its own bitmap, so closing it is safe.

## Rules (they make renders exact and scrubbing correct)

- **Time only comes from `t`.** No `performance.now`, `Date`, `requestAnimationFrame`,
  `setTimeout`, `THREE.Clock`, `video.play()`.
- **`update()` depends only on `t` / `frame`** (and what `setup()` built). The preview scrubs back
  and forth; the export runs `update()` over every frame once in advance to plan video decoding.
- **GSAP:** put tweens on `ctx.timeline()` (created paused; Pullup seeks it to `t` each frame).
  Tween plain objects and read the values in `update()`. `onUpdate`/`onComplete` don't fire.
  DOM plugins (SplitText, ScrollTrigger, Flip) are unavailable — split words with
  `ctx.layoutText()` (it returns per-word positions) and animate them yourself.
- **Randomness:** `ctx.random()` in `setup()` only; `ctx.hash(frame, k)` for per-frame noise (grain).
- **Opaque output:** WebGL `{ alpha: false }` / 2D `{ alpha: false }` (or always write alpha 1).
- **Transparent 2D layers** (text drawn onto its own canvas, then composited): create them with
  `getContext('2d', { willReadFrequently: true })`. GPU-rasterised large glyphs can differ by a
  few pixels between runs; the CPU rasteriser is exact, so renders stay reproducible.
- **Colour:** keep everything sRGB (`renderer.outputColorSpace = SRGBColorSpace`, textures
  `colorSpace = SRGBColorSpace`). Pullup tags the MP4 BT.709. In a custom `ShaderMaterial`:
  - **End the fragment shader with `#include <colorspace_fragment>`** — image textures are sampled
    as linear light and three.js only converts built-in materials back to sRGB; without it the
    render is noticeably darker than the source.
  - **Decode video samples yourself: `sRGBTransferEOTF(texture2D(uVideo, uv))`** — three.js
    uploads video frames undecoded (only its built-in materials decode them), so without it video
    comes out washed out. Images must not be decoded twice: use a uniform flag per input
    (examples in git history: `device-frame`, `shader-transition` at commit 2d3c978).
  - Composite type and add grain in sRGB (`sRGBTransferOETF` → mix → back with
    `sRGBTransferEOTF`): grain added in linear light is much stronger in the shadows and pushes
    the bitrate over Instagram's limit.
  - Check colour with a real recording, not a test pattern of pure colours (it can't show gamma
    errors).
- **Design units:** layout is designed at 1080 px on the frame's short side (1080 wide for
  9:16, 4:5 and 1:1; 1080 tall for 16:9); multiply by `ctx.scale` (the preview is half size).
  `ctx.width / ctx.scale` is the design width (1920 on 16:9).
- **Images** come upright and colour-managed (≤ 2160 px). For Three.js use `imageTexture()` from
  `_lib/three.ts` (it handles the ImageBitmap flip).
- **Videos** are decoded from a proxy (30 fps, keyframe every 15 frames). Hold the last frame past
  the clip's end: `seek(Math.min(t, layer.duration))`.
- **Fonts** are files in the library's `fonts/` folder (`~/Pullup/fonts/`), declared in `meta.fonts`.
  Licensed fonts never go in this repo.

## Output

- Stories/reels **9:16** (1080×1920), feed/carousel **4:5** (1080×1350), square **1:1**, wide
  **16:9** (1920×1080 — X, LinkedIn, YouTube). One list: `ASPECTS` / `ASPECT_SIZE` /
  `ASPECT_LABEL` in `src/shared/template.ts`. Builder frames stay 9:16 (stories) and 4:5 (feed).
- Video: H.264 High, 30 fps, 14 Mbps, keyframe every second, no B-frames, fast start, BT.709.
- Stills: JPEG, quality 0.92.
- Every render is checked against Instagram's upload rules; warnings show under the result.
- Renders are saved in `~/Pullup/media/renders/` with the inputs that made them (reproducible).
- A video render can also be exported as a looping GIF or animated WebP (Small 480 / Medium 720 /
  Large 1080 px wide), made from the MP4 on demand and kept next to it.
