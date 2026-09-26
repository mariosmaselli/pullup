# Templates

Each folder here is one template: something Pullup renders into a story frame, a carousel slide
or a short video. Templates run in a Web Worker on an `OffscreenCanvas` and are exported
frame-by-frame, so a 6 s 1080×1920 WebGL video renders in about a second.

```
templates/
  _lib/            shared helpers (layout options, caption card, text drawing, Three.js) — not a template
  my-template/
    meta.ts        export const meta: TemplateMeta   ← name, formats, inputs, fonts
    index.ts       export default (ctx) => ({ setup, update, render, dispose })
```

New folders show up in **Templates** automatically (Vite picks them up; no registration).
The full contract with comments is in [`src/shared/template.ts`](../src/shared/template.ts).
Look at [`text-story`](text-story) (canvas 2D still), [`image-caption`](image-caption) (canvas
2D media + type) and [`video-caption`](video-caption) (the same card over a clip) first;
Kept in git history, removed because they didn't meet Mario's bar (useful as code references,
not as designs): `slow-zoom`, `case-study-cover`, `planes-3d` (commit 4bfcd7c) and
`crossfade-slideshow`, `shader-transition` (Three.js multi-clip transitions, video decode in a
custom shader), `device-frame` (3D device scene) — commit 2d3c978.

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

Helpers (all in canvas px):

- `mediaSize(ctx.params)` / `textPlacement(ctx.params)` — read the values, tolerating missing or
  stale ones (anything but `'Fit'` is Fill).
- `mediaRect(frameW, frameH, mediaW, mediaH, { size, scale, focusX, focusY })` → `{ x, y, w, h }`,
  the destination rect relative to the frame. It may extend past the frame: clip, and fill the
  ground first. Canvas 2D: `drawImage(source, x, y, w, h)`; WebGL: derive the UV scale/offset.
- `textBlockY(frameH, blockH, position, { top, bottom })` → top y of a text block (Middle centres
  on the frame, kept inside the margins).
- `textLineX(frameW, lineW, align, side)` → x of one line (`ctx.layoutText` lines carry `width`).

[`_lib/caption.ts`](_lib/caption.ts) is the whole "media + caption" card built on these (caption,
corner label/index, gradient that follows the caption and only darkens the media, optional per-line
fade/rise) — `image-caption` and `video-caption` are thin wrappers around it. Share code between
templates through `_lib/`, never by importing another template's folder.

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
- **Design units:** layout is designed at 1080 px wide; multiply by `ctx.scale` (the preview is
  half size).
- **Images** come upright and colour-managed (≤ 2160 px). For Three.js use `imageTexture()` from
  `_lib/three.ts` (it handles the ImageBitmap flip).
- **Videos** are decoded from a proxy (30 fps, keyframe every 15 frames). Hold the last frame past
  the clip's end: `seek(Math.min(t, layer.duration))`.
- **Fonts** are files in the library's `fonts/` folder (`~/Pullup/fonts/`), declared in `meta.fonts`.
  Licensed fonts never go in this repo.

## Output

- Stories/reels **9:16** (1080×1920), feed/carousel **4:5** (1080×1350), square **1:1**.
- Video: H.264 High, 30 fps, 14 Mbps, keyframe every second, no B-frames, fast start, BT.709.
- Stills: JPEG, quality 0.92.
- Every render is checked against Instagram's upload rules; warnings show under the result.
- Renders are saved in `~/Pullup/media/renders/` with the inputs that made them (reproducible).
- A video render can also be exported as a looping GIF or animated WebP (Small 480 / Medium 720 /
  Large 1080 px wide), made from the MP4 on demand and kept next to it.
