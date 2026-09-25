# Templates

Each folder here is one template: something Pullup renders into a story frame, a carousel slide
or a short video. Templates run in a Web Worker on an `OffscreenCanvas` and are exported
frame-by-frame, so a 6 s 1080×1920 WebGL video renders in about a second.

```
templates/
  _lib/            shared helpers (text drawing, Three.js setup) — not a template
  my-template/
    meta.ts        export const meta: TemplateMeta   ← name, formats, inputs, fonts
    index.ts       export default (ctx) => ({ setup, update, render, dispose })
```

New folders show up in **Templates** automatically (Vite picks them up; no registration).
The full contract with comments is in [`src/shared/template.ts`](../src/shared/template.ts).
Look at [`text-story`](text-story) (canvas 2D still) and [`image-caption`](image-caption) (canvas
2D media + type) first; [`shader-transition`](shader-transition) (Three.js, GSAP, video textures,
several clips) and [`device-frame`](device-frame) (3D scene) show WebGL. Removed for now and kept in
git history (commit 4bfcd7c): `slow-zoom`, `case-study-cover`, `planes-3d` (to be reworked).

## The lifecycle

|                    | When        | Do                                                                                                                                                                                                                                |
| ------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setup()`          | once        | Create the renderer / 2D context, load textures (`await ctx.image(i)`), wire video textures (`ctx.video(i)`), load fonts (`ctx.font`), lay out text (`ctx.layoutText`), build GSAP timelines (`ctx.timeline()`), compile shaders. |
| `update(t, frame)` | every frame | Set uniforms/positions from `t` and from values your timelines tween. Request video frames: `ctx.video(i).seek(localTime)`.                                                                                                       |
| `render()`         | every frame | Draw. Synchronous — no `await`. For video textures call `sync()` first (see `_lib/three.ts`).                                                                                                                                     |
| `dispose()`        | once        | Free GPU resources.                                                                                                                                                                                                               |

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
    (see `device-frame`, `shader-transition`).
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
