# Template rendering — research (2026-09-25)

Decision: **WebGL templates (Three.js/raw WebGL + GSAP) rendered frame-by-frame in the browser, encoded with WebCodecs via Mediabunny.** Tested on Mario's M2 Max: 15 s 1080x1920@30 in ~3–4 s, deterministic, Instagram-compliant MP4. Remotion rejected (always-on render telemetry breaks local-only; also a 3-person license cap).

## Verdict

Yes, WebGL templates are a good fit for Pullup, and they don't need Remotion, a headless farm or ffmpeg frame piping. Render them inside Pullup's own browser page, one frame at a time: Three.js (WebGL2, or WebGPU) plus GSAP, driven only by an explicit time t. Video clips come in as frames decoded by Mediabunny, uploaded with THREE.VideoFrameTexture. Each frame is encoded with WebCodecs H.264 through Mediabunny's CanvasSource into a fast-start MP4, and the finished file is POSTed to the Hono server, which stores it through the asset store.

I tested this on Mario's Mac (M2 Max, Chrome 153, three r186, GSAP 3.15, Mediabunny 1.60) on 2026-09-25. A 15 s 1080x1920 30 fps render took 3.1–4.2 s, about 4× faster than real time, including a decoded 1080x1920 video texture, a post-processing pass and grain. A heavy variant with 24 extra full-screen passes took 6.6 s, and 60 fps took 7 s.

The files already meet Instagram's ingest rules:
- H.264 High profile, yuv420p, BT.709, no B-frames, keyframe every 1 s
- the index (moov) at the front of the file, no edit lists
- an optional AAC 48 kHz music track

Output was identical frame for frame across runs, between main thread and worker, and between visible and hidden tabs, without preserveDrawingBuffer.

On the alternatives:
- **Remotion** is free for a studio of up to 3 people. But its in-browser renderer is the same mechanism (WebCodecs through Mediabunny) wrapped in a React model, and it always sends a telemetry event on every render. That breaks Pullup's local-only rule, so skip it.
- **Headless Chrome and HeyGen's HyperFrames** are useful only later, for batch renders when the app is closed. Headless Chrome on this Mac runs the same page on the GPU and produces identical output.
- **Theatre.js** has had no npm release since May 2024, so don't depend on it.

## Fact-check

Yes, with changes. The core mechanism holds up. I reproduced it on this M2 Max on 2026-09-25: Three.js and GSAP driven only by an explicit time t, Mediabunny for decoding video into VideoFrameTexture, and Mediabunny CanvasSource over WebCodecs H.264 into a fast-start MP4. A 15 s 1080x1920 render took 3.2 s, 3.8 s with a video texture, and 6.3 s at 60 fps. Repeated runs decoded to identical frames. Luma is correctly limited range, there is no off-by-one frame, there is no edts, moov comes first, and Mediabunny picks the wrong H.264 level at 60 fps unless you pass the codec string, as the report said. Remotion's always-on telemetry and Theatre.js's stall are also confirmed, so skipping both is right.

Corrections:
1. **Headless only.** All evidence comes from headless Chrome, not from a headful Pullup page. Validate the in-app path once before building on it.
2. **The iframe doesn't protect the UI.** A same-origin iframe gives a separate JS realm but shares the main thread. Make the OffscreenCanvas Worker (already tested) the export host, so rendering doesn't freeze Pullup's UI.
3. **Contract fixes before Mario writes templates:**
   - Stateless per-frame randomness (a hash of seed and frame, not a PRNG called in update()).
   - All troika text layout done in setup().
   - One chosen ImageBitmap flipY/EXIF convention.
   - An opaque canvas (alpha:false).
   - Video clip schedules precomputed with a dry run of update().
   - Font loading through ctx.
4. **Normalise input colour in the proxy step.** P3 screenshots and recordings and HDR clips need converting to BT.709 SDR. Consider retagging every output from transfer sRGB(13) to bt709 losslessly by default, until a real Instagram test-card upload shows which tag looks right.
5. **Reproducibility is narrower than claimed.** It holds only for the same encoder, GPU and browser build; the software-encoder render decoded to different frames. Hash pre-encode pixels for template tests.
6. **Publishing will likely be manual, in-app.** The Graph API needs a public URL, which conflicts with local-only. In that case music is usually added in-app, and the "seamless" carousel continuity only holds at slide edges.

Treat Chrome as the only supported render browser. Gate every output with ffprobe, adding checks for peak bitrate and colour tags. Get Mario's approval for the dependencies (three, gsap, mediabunny, optionally troika-three-text).

## Pipeline

Unless marked "not tested", every step below was checked on this Mac on 2026-09-25. The test harness is in the session scratchpad at /private/tmp/claude-501/-Users-mariosmaselli-Sites-tools/07ffe702-9c38-4ffe-91e4-88312a158b7b/scratchpad/bench/: bench.js is the main-thread render, worker.js the OffscreenCanvas version, run.mjs the puppeteer-core runner, and out/ holds the MP4s. The scratchpad is session-only; copy anything you want to keep.

0. DEPENDENCIES (ask Mario first, per doctrine): three, gsap and mediabunny in the client. Add @mediabunny/aac-encoder only if the render browser lacks native AAC; Chrome 153 has it. Nothing new on the server; ffmpeg/ffprobe are already there.

1. PREPARE MEDIA (server, existing processing queue, rebuildable files in cache/<id>/):
   - Video: make a proxy with ffmpeg: H.264, 1080 px on the long side, constant 30 or 60 fps, yuv420p, keyframe every 15 frames (-g 15). This makes screen recordings (variable frame rate, HEVC or ProRes) seek fast and decode the same way every time.
   - Images: use the original, or poster.jpg for HEIC. Decode with createImageBitmap(blob, {imageOrientation:'from-image'}).
   - The render page reads everything from /api/files/... using byte ranges, which Pullup already supports.

2. RENDER HOST: a route such as /render-host?template=<id> that runs in its own iframe, so it has its own JS realm. That gives it its own gsap and three instances, so unhooking GSAP's ticker never affects the React UI. Reloading the iframe gives a clean GPU context for each render and picks up template edits through Vite HMR.
   - On boot: gsap.ticker.remove(gsap.updateRoot) and gsap.ticker.lagSmoothing(0).
   - The template contract has no DOM access, so the same code can later move into a Worker with an OffscreenCanvas. I tested the worker version: 124 fps with identical output.

3. PREVIEW (real time): a requestAnimationFrame loop.
   - t comes from the music element's currentTime, or from a performance clock when there is no music.
   - Each frame: inst.update(t), then media.resolve({blocking:false}) (uses the latest decoded frame and never waits), then inst.render().
   - The canvas renders at a reduced scale, for example 540x960, via ctx.scale. Scrubbing uses the same path.

4. EXPORT (frame-stepped, never rAF):
   - N = round(duration*fps). For each frame i: t = i/fps; seek every registered GSAP timeline to t with tl.seek(t); inst.update(t,i); await media.resolve(), which decodes the requested video frames, calls VideoFrameTexture.setFrame and closes the previous frames; inst.render(); await canvasSource.add(t, 1/fps).
   - Do not await anything between render() and add(). add() builds new VideoFrame(canvas) synchronously, so the WebGL drawing buffer is captured in the same task and preserveDrawingBuffer can stay false.
   - Video frames come from Mediabunny: new Input({source:new UrlSource(proxyUrl), formats:ALL_FORMATS}), then new VideoSampleSink(track), then samplesAtTimestamps(precomputedTimes), then sample.toVideoFrame(). Seeking an HTMLVideoElement once per frame was 5.5× slower in testing.
   - Before rendering, await document.fonts.load for each template font (self.fonts in a worker). Also upload textures and compile shaders (renderer.compile) during setup.

5. ENCODE:
   - `const output = new Output({format:new Mp4OutputFormat({fastStart:'in-memory'}), target:new BufferTarget()})`
   - `const src = new CanvasSource(canvas, {codec:'avc', bitrate: fps===60?20e6:16e6, keyFrameInterval:1, latencyMode:'quality', hardwareAcceleration:'prefer-hardware', fullCodecString: fps===60?'avc1.64002a':'avc1.640028'})`
   - `output.addVideoTrack(src,{frameRate:fps})`
   - Pass fullCodecString explicitly: Mediabunny picks the H.264 level without looking at frame rate, so a 60 fps render would otherwise be labelled level 4.0 instead of 4.2.
   - Check VideoEncoder.isConfigSupported (or Mediabunny canEncodeVideo) first, and fall back to 'prefer-software'.
   - Tested result: H.264 High, level 4.0 or 4.2, yuv420p limited range, BT.709 primaries and matrix, transfer tagged sRGB, no B-frames, keyframe every 1 s, ftyp→moov→mdat order, no edit list, about 30 MB per 15 s at 16 Mbps. That is under Instagram's 25 Mbps and 100/300 MB limits.
   - Keep the canvas in sRGB, not display-p3, and set renderer.outputColorSpace = SRGBColorSpace. If Instagram playback shows a gamma shift, retag without re-encoding: `ffmpeg -i in.mp4 -c copy -bsf:v h264_metadata=transfer_characteristics=1 -color_trc bt709 -movflags +faststart out.mp4` (tested: pixels unchanged).

6. AUDIO (optional music):
   - Preferred, in the browser:
     - Main thread: decode the track and trim it or add a fade with OfflineAudioContext at 48 kHz stereo, then `const a = new AudioBufferSource({codec:'aac', bitrate:128e3}); output.addAudioTrack(a)`. After output.start(), `await a.add(buffer); a.close()`. Tested: AAC-LC 48 kHz stereo, adds about 0.1 s, no edit list.
     - In a Worker there is no OfflineAudioContext. Decode with Mediabunny's AudioSampleSink instead.
   - Fallback, on the server: `ffmpeg -i video.mp4 -i music.m4a -map 0:v -map 1:a -c:v copy -c:a aac -b:a 128k -ar 48000 -af afade=t=out:st=<d-0.5>:d=0.5 -shortest -use_editlist 0 -movflags +faststart out.mp4`. Took 0.6 s in testing. By default ffmpeg writes an edit list for AAC priming, which Instagram's API spec forbids; -use_editlist 0 removes it.

7. HAND-OFF TO THE SERVER:
   - The page does `await output.finalize()`, then POSTs output.target.buffer as a raw body to a new `POST /api/renders?...`, using the same streaming and SHA-256 path as /api/assets/upload.
   - The server writes the file through the asset store to media/YYYY/MM/<template>-<id>.mp4, so SSE change events fire, and inserts a `renders` row: template_id, template_version, inputs_json (asset ids, text, colors, params, seed, aspect, fps, duration), output_asset_id, encoder_json and elapsed_ms. The render can then be reproduced exactly.
   - The output inherits the most restrictive visibility of its inputs (private stays private).
   - ffprobe checks the file against the Instagram spec: codec, pix_fmt, fps 23–60, width ≤1920, 3–60 s for Stories, bitrate ≤25 Mbps, moov at the front, no edts. Then the existing queue creates poster and thumbnail.

8. CAROUSELS:
   - One template timeline, cut into slides by meta.slides(inputs) as [start,end) ranges. Each slide becomes its own 1080x1350 MP4 (each at least 3 s), which allows seamless swipe-continuous carousels.
   - Still slides: after render() at the chosen t, call canvas.convertToBlob/toBlob to get a PNG or JPEG.
   - Instagram API limits: up to 10 items mixing images and video, first slide sets the crop. In the app: up to 20 items, video slides up to 60 s. Reels cannot be carousel items.

9. LATER, OPTIONAL: queued or batch renders with the app closed. puppeteer-core drives the system Chrome in headless mode to /render-host. Tested: Chrome 153 headless uses ANGLE Metal on the GPU, runs at the same speed and gives identical output, with no ffmpeg frame piping. This needs Mario's approval for the dependency.

## Template contract (draft — apply the fact-check fixes below)

```ts
// src/shared/template.ts: types only. Templates live in pullup/templates/<id>/index.ts and are discovered with import.meta.glob.
import type * as THREE from 'three'
import type { gsap } from 'gsap'

export type Aspect = '9:16' | '4:5' | '3:4' | '1:1'   // 1080x1920 | 1080x1350 | 1080x1440 | 1080x1080
export type ParamSpec =
  | { type: 'color'; label: string; default: string }
  | { type: 'number'; label: string; min: number; max: number; step?: number; default: number }
  | { type: 'select'; label: string; options: string[]; default: string }
  | { type: 'boolean'; label: string; default: boolean }

export interface TemplateMeta {
  id: string; name: string
  version: number                      // bump when output changes; stored with every render so re-renders are exact
  aspects: Aspect[]
  fps?: 30 | 60                        // default 30
  duration: { default: number; min: number; max: number } | ((i: TemplateInputs) => number)
  media: { min: number; max: number; kinds: ('image' | 'video')[] }
  text?: Record<string, { label: string; max?: number; optional?: boolean }>
  params?: Record<string, ParamSpec>   // Pullup generates the form UI from this
  fonts?: { family: string; url: string; weight?: string; style?: string }[]  // e.g. PP Neue Montreal (.otf/.woff; troika cannot read woff2)
  slides?: (i: TemplateInputs) => { start: number; end: number; still?: number }[]  // carousel cut points, in seconds
}

export interface MediaInput { id: string; kind: 'image' | 'video'; width: number; height: number; duration?: number }

export interface TemplateInputs {
  media: MediaInput[]; text: Record<string, string>
  colors: { bg: string; fg: string; accent: string }
  params: Record<string, unknown>
  aspect: Aspect; width: number; height: number; fps: number; duration: number; seed: number
}

export interface VideoLayer {
  readonly texture: THREE.VideoFrameTexture   // Pullup owns it: setFrame() and closing old frames
  readonly frame: VideoFrame | null           // for raw WebGL: texImage2D(..., frame)
  readonly duration: number
  seek(localTime: number): void               // a request only; Pullup resolves it between update() and render()
}

export interface TemplateContext extends TemplateInputs {
  canvas: HTMLCanvasElement | OffscreenCanvas // exact output pixels when rendering; scaled down in preview
  mode: 'preview' | 'render'
  scale: number                               // canvas px per design px (design space is 1080 wide); size grain, type and blur with it
  random: () => number                        // seeded PRNG (e.g. mulberry32(seed)); the ONLY allowed randomness
  image(i: number): Promise<ImageBitmap>      // EXIF-oriented, cached
  video(i: number): VideoLayer
  timeline(vars?: gsap.TimelineVars): gsap.core.Timeline  // gsap.timeline({ paused: true, ...vars }), registered with the host
  gsap: typeof gsap                           // this realm's instance, ticker already unhooked
  signal: AbortSignal                         // aborted on cancel or dispose
}

export interface TemplateInstance {
  setup(): Promise<void>          // load textures and models, await ctx fonts, renderer.compile(); no time-dependent state
  update(t: number, frame: number): void   // must depend only on t: set uniforms, mixer.setTime(t), layer.seek(), read tweened values
  render(): void                  // synchronous draw into ctx.canvas: no awaits, no rAF
  resize?(width: number, height: number, scale: number): void
  dispose(): void
}

export type TemplateModule = { meta: TemplateMeta; default: (ctx: TemplateContext) => TemplateInstance }

/* HOST LOOPS (Pullup owns both loops; templates never loop on their own)
   boot:    gsap.ticker.remove(gsap.updateRoot); gsap.ticker.lagSmoothing(0)
   preview: rAF → t = music ? audio.currentTime : clock
            → timelines.forEach(tl => tl.seek(t)); inst.update(t, round(t*fps))
            → media.resolve({ blocking: false }); inst.render()
   render:  for i in 0..N-1: t = i/fps
            → timelines.forEach(tl => tl.seek(t)); inst.update(t, i)
            → await media.resolve(); inst.render(); await canvasSource.add(t, 1/fps)
            (nothing awaited between render() and add())

   RULES THAT MAKE GSAP, THREE.JS AND SHADERS DETERMINISTIC
   - Time comes only from t. Never use performance.now, Date, THREE.Clock (deprecated since r183) or Timer,
     renderer.setAnimationLoop, rAF, setTimeout, video.play(), or gsap.delayedCall outside a registered timeline.
   - GSAP: put every tween in ctx.timeline() timelines. The host seeks them with tl.seek(t), where suppressEvents
     defaults to true, so onUpdate/onComplete do NOT fire. Tween the target values directly (camera.position,
     material.uniforms.uProgress, a proxy object read in update()). Repeats and yoyo are fine; seek works on total
     time. As a safety net for stray tweens the host may also call gsap.updateRoot(t) (not tested for scrubbing
     backwards).
   - Three.js: uniforms.uTime.value = t; AnimationMixer.setTime(t); keep particles and noise as pure functions of
     (t, seed). Feedback or trail effects that need the previous frame, and simulations, must re-simulate with a
     fixed step from 0 (or from a cached state), because preview scrubbing jumps around.
   - Randomness: only ctx.random, drawn in setup() or as a function of the frame index.
   - Video: call ctx.video(i).seek(localT) in update(). Pullup decodes the exact frame (last frame at or before
     localT), holds the last frame after the clip ends, and closes old frames. VideoFrameTexture does not close
     frames itself.
   - Colour: renderer.outputColorSpace = SRGBColorSpace, and colorSpace = SRGBColorSpace on image and video
     textures. For MSAA through post chains, use WebGLRenderTarget({ samples: 4 }).
   - Resolution independence: lay out in 1080-wide design units multiplied by ctx.scale, so a 540x960 preview
     matches the 1080x1920 file.
   - No DOM access in templates (canvas only; text via canvas 2D after font load, or troika-three-text), so the
     render host can move into a Worker with OffscreenCanvas without code changes.
   - Raw WebGL or OGL templates follow the same contract. Three's WebGPURenderer also works: capture was frame-exact
     in testing (await renderer.init() in setup). */
```

## Pipeline issues to fix

- Step 2 (render host): the iframe isolates GSAP's singleton but not the main thread, so export will jank or freeze Pullup's React UI. Make the OffscreenCanvas Worker the export host (it was tested). Keep the iframe for real-time preview and HMR, or run preview in the worker too, with a transferred canvas.
- The iframe/worker 'no DOM' rule collides with fonts: in a worker, FontFace must be constructed from fetched bytes and added to self.fonts, and troika loads fonts itself by URL. Specify one font-loading helper in ctx (ctx.font(family)) instead of 'await document.fonts.load'.
- Step 3 (preview): t from audio.currentTime is coarse and jittery (updated per audio render quantum and varies by browser). Interpolate with performance.now between currentTime updates, or use AudioContext.getOutputTimestamp, or motion will stutter.
- Step 4: the harness calls tl.seek(t, false) while the contract says seek(t) with suppressEvents=true. Decide on one and test that exact path. Also, gsap.updateRoot(t) as a 'safety net' advances the global timeline, which also contains the registered timelines if they are not paused/removed. Registered timelines should be created paused (the contract does this) and the safety net should stay off until tested.
- Step 4: samplesAtTimestamps(precomputedTimes) needs each clip's full local-time schedule ahead of time. That conflicts with VideoLayer.seek(localTime) being decided per frame in update(). Either precompute by running update() in a dry pass over all frames (cheap, since update is pure), or use a lookahead window. As written, the contract and the Mediabunny call don't compose.
- Step 1 (proxy): -g 15 plus B-frames is fine, but also add -bf 0 or keep closed GOPs for faster random access; normalise colour to BT.709 SDR and tag it; set fps with -fps_mode cfr (the modern flag); keep audio out of the proxy. Also derive capped-resolution image derivatives, not only poster.jpg for HEIC.
- Step 5 (colour): exporting with transfer=13 (sRGB) is untested against Instagram. The fallback retag needs an ffmpeg pass per file anyway, so consider making the bt709 retag (-c copy, lossless, tested) the default final step on the server and validating it with one real test-card upload.
- Step 5: bitrate 16/20 Mbps average is under the 25 Mbps cap, but VideoToolbox VBR peaks were not measured. Add a peak-bitrate check (ffprobe per-second packet sums) to the step 7 validation, or lower the target to about 12-14 Mbps, since Instagram re-encodes anyway.
- Step 6: the in-browser AAC track runs 80 ms longer than the video and priming is untrimmed. Instagram will likely use min(duration), but -shortest behaviour after its transcode is unverified. For beat-synced templates, render against the decoded PCM timeline and verify offset with a click-track test.
- Step 7: the ffprobe gate should also assert has_b_frames=0 or closed GOP, audio sample rate <=48 kHz, the duration window per target (Stories 3-60 s, Reels >=3 s), width <=1920, and the absence of edts. Most of these are listed; add peak bitrate and colour tags.
- Step 8: the per-slide minimum of 3 s and 'seamless' claims rely on API rules and on assumptions about how the app plays carousels. Validate in-app, since Mario will likely upload manually.
- Template contract: replace ctx.random with a stateless ctx.hash for per-frame use; document the ImageBitmap flipY/EXIF convention; ban text re-layout outside setup; require alpha:false or opaque output; specify 'dry-run update() to precompute video schedules'; expose font loading via ctx; add a dev harness with 'render twice, compare pre-encode pixel hashes' and 'scrub backwards equals forward'.
- Dependencies: three, gsap and mediabunny (and optionally troika-three-text, puppeteer-core) still need Mario's explicit approval per doctrine. Mediabunny MPL-2.0 is file-level copyleft only if its files are modified. PP Neue Montreal's licence for video or broadcast use was not checked by anyone.

## Missed by first pass

- Headful path untested: every number comes from headless Chrome. Before committing, run one headful export inside a same-origin iframe in the real Vite/React app and compare its framemd5 with the headless output.
- An iframe gives a separate JS realm but NOT a separate thread: same-origin iframes share the parent's main thread. A heavy template's render() blocks Pullup's React UI for the whole export (3-8 s of back-to-back frames). A Worker with OffscreenCanvas (tested at 124 fps with identical output) is the better default export host; keep the iframe for preview and HMR.
- ImageBitmap + WebGL flipY: WebGL ignores UNPACK_FLIP_Y for ImageBitmap, so three.js needs texture.flipY=false plus flipped UVs, or bitmaps created with imageOrientation:'flipY'. The option is a single enum, so 'from-image' (EXIF) and 'flipY' cannot both be passed. Whether 'flipY' applies EXIF orientation first depends on the spec revision and browser, so verify it. The contract's image() helper must pick one convention and document it.
- Colour of INPUTS, not just output: macOS screenshots are usually Display P3-tagged PNGs, and screen recordings or iPhone clips may be P3 or HDR (HLG/PQ). The proxy step should normalise video to BT.709 SDR explicitly (ffmpeg colorspace/zscale + tonemap for HDR, explicit -colorspace/-color_primaries/-color_trc bt709 tags). Check how createImageBitmap/WebGL unpack converts P3 PNGs (colorSpaceConversion, unpackColorSpace), or saturated UI colours will clip or shift.
- Premultiplied alpha: the renderer should use alpha:false, or every template must write alpha=1. Mediabunny creates VideoSamples with alpha 'keep'. A template that clears to transparent, or blends to alpha<1, gives premultiplied or black-fringed pixels after YUV conversion. The bench only worked because its post shader writes alpha 1.0.
- Contract bug, ctx.random: a stateful seeded PRNG (mulberry32) called 'as a function of the frame index' in update() is only deterministic in strict sequential export, not when scrubbing. Provide a stateless ctx.hash(seed, frame, k) for per-frame randomness and allow ctx.random() only in setup().
- Contract gap, troika-three-text: text.sync() lays out asynchronously (in its own worker). Changing .text or font props in update() means render() can draw stale glyphs, which is non-deterministic. Rule: all text layout happens in setup(), awaiting sync, and kinetic type animates per-glyph through uniforms or transforms only. It is also unverified that troika works inside a Worker/OffscreenCanvas host, since it spawns its own workers.
- GSAP DOM plugins (SplitText, ScrollTrigger, Flip, MorphSVG on DOM) are unusable under the no-DOM rule. Kinetic typography therefore needs its own glyph splitting (troika glyph ranges, or canvas-2D atlas). Say so in the template authoring docs.
- Preview decode strategy: Mediabunny random-access decode per rAF frame, for up to 10 clips, was never measured. Scrubbing costs a seek to the previous keyframe plus up to 14 decodes per clip with -g 15. Consider sequential VideoSampleSink.samples() iterators during playback, or HTMLVideoElement for preview only, and measure concurrent hardware decoder sessions with several clips.
- GPU/texture memory numbers were never measured. A Retina screenshot (e.g. 3456x2234 RGBA) is about 31 MB, or about 41 MB with mipmaps, plus the ImageBitmap copy. 10 of those is roughly 0.4-0.8 GB. Generate a capped image derivative (e.g. 2160 px long side = 2x design width) in cache/<id>/ and use createImageBitmap resize options.
- Reproducibility scope: framemd5 identity holds only for the same encoder. The software-encoder file v_30_sw decodes to different frames, and Chrome, ANGLE or macOS updates can change shader float results. Template regression tests should hash the pre-encode pixels (readPixels on sampled frames) rather than the decoded MP4, and 'template_version makes re-renders exact' should be worded as 'same inputs, same pipeline'.
- Instagram publishing reality: the Graph API needs video_url on a public server, or Meta's resumable upload, and a Business/Creator account plus a Meta app. That conflicts with local-only, so Mario will most likely AirDrop files and upload in-app, where limits and re-encoding differ from the API spec. Music is also normally added in-app from Instagram's licensed library: baking a commercial track into the MP4 risks muting or blocking. The in-browser AAC path may be worth less than assumed.
- 'Seamless swipe-continuous carousels' is overstated for video. Each carousel video plays on its own when swiped to, with no shared timeline, so continuity only holds at slide boundaries (first and last frames). Instagram also crops every item to the first item's aspect.
- HEVC hardware encode is available (isConfigSupported true for hvc1.1.6.L123.B0 in the probe) and Instagram accepts HEVC. H.264 is still the safer default, but HEVC is an option for smaller files at the same quality.
- WebGL context loss and cancellation are not handled in the host loop (webglcontextlost -> abort, dispose, report). Long or heavy renders on base M-series chips make this more likely.

## Risks

- Only Chrome 153 on an M2 Max was tested. Safari 26 has full WebCodecs including AudioEncoder, but capturing a WebGL canvas into a VideoFrame, colour tagging and speed in Safari were not verified. Treat Chrome as the supported render browser and run the ffprobe check on every output.
- Speed depends on the machine. Base M1/M2/M3 chips have far fewer GPU cores than an M2 Max, so heavy shader or post-processing templates may render 2–4× slower. That estimate is unmeasured; it will likely stay near or above real time.
- Colour: Chrome tags the output with an sRGB transfer (13) and BT.709 primaries and matrix. It is unverified how Instagram's transcoder and iOS/Android players interpret that. Upload a test card (grey ramp plus saturated swatches) once. If gamma shifts, retag to bt709 losslessly with the h264_metadata bitstream filter. Never export from a display-p3 canvas.
- Mediabunny's automatic H.264 level ignores frame rate: 60 fps at 1080x1920 is mislabelled as level 4.0 unless fullCodecString 'avc1.64002a' is passed. Its Quality presets also ignore fps, so set explicit bitrates.
- Instagram's API spec says 'no edit lists'. ffmpeg adds an edts for AAC priming by default (use -use_editlist 0). Mediabunny's in-browser AAC avoids the edit list but leaves priming untrimmed (audio 15.08 s vs video 15.00 s), a sub-100 ms offset. Fine for music beds; not for frame-exact beat sync until verified.
- Template discipline is what makes output deterministic. Any use of performance.now, Date, Math.random, THREE.Clock or Timer, setAnimationLoop, GSAP callbacks (seek suppresses them by default), gsap.delayedCall outside registered timelines, or simulations with frame-to-frame state will break render-equals-preview, scrubbing or reproducibility. Write a lint or dev check, and a 'render twice, compare framemd5' test, into the template harness.
- Video inputs vary: screen recordings are often variable frame rate, and there are HEVC and ProRes clips, rotations and long GOPs. Without the ffmpeg proxy step, decode support and seek latency will vary; build proxies on import as rebuildable derivatives in cache/<id>/.
- GPU memory and resources: VideoFrames (about 8 MB each at 1080p) must be closed promptly, and Remotion reports ANGLE memory leaks on long renders. Use a fresh render-host iframe or worker per render and dispose renderer, render targets and textures.
- GSAP is a module singleton. Unhooking its ticker in the same realm as any GSAP-driven UI would freeze that UI, so templates must run in their own iframe or worker realm.
- Instagram re-encodes uploads. Fine grain, 1 px lines and thin type at small sizes get smeared, so design grain and type for Instagram's re-encode and test on a real upload. The in-app specs (20-slide carousels, 60 s carousel videos, 3:4 posts, 3-minute Reels) come from third-party sources and change often; the Meta API spec is authoritative only for API publishing.
- Licences: GSAP forbids use in no-code visual animation builders that compete with Webflow, so revisit if Pullup is ever offered to others. Remotion's client-side renderer sends mandatory telemetry, which conflicts with local-first. Theatre.js is stalled publicly. Mediabunny is MPL-2.0, so modified Mediabunny source files would have to be published. Check that the PP Neue Montreal licence covers use in rendered video.
- New dependencies (three, gsap, mediabunny, and optionally puppeteer-core for headless batch renders) need Mario's approval under the 'Dependencies must earn their place' doctrine.
- The benchmark harness and outputs live only in the session scratchpad (/private/tmp/claude-501/-Users-mariosmaselli-Sites-tools/07ffe702-9c38-4ffe-91e4-88312a158b7b/scratchpad/bench/) and will be lost when the session ends unless copied.

## Earlier comparison (stills + video engines)

Mostly confirmed. The verdict holds: Remotion 4.x (Chrome-rendered React/HTML templates) with a mandatory ffmpeg remux and an ffprobe validator is the right $0 local engine for Mario, and he qualifies for the Free License as an individual or a studio of 3 or fewer. I re-checked the local tests (edts removal, Chrome emoji, drawtext boxes) and they hold up. Corrections: (1) Remove the 'browserExecutable = installed Google Chrome' fallback. Desktop Chrome has had no old headless mode since Chrome 132, and Remotion warns against it. Chrome Headless Shell uses OS emoji per Remotion's docs; auto-install is badged v4.0.247, not 4.0.208. (2) @remotion/gsap supports no GSAP plugins, SplitText included, and rejects callbacks and randomness. Text-reveal templates must split words in React. (3) HEVC clips go through the OffthreadVideo fallback in <Video>, so transcode on ingest. Design changes the researcher missed: templates must render several sizes per platform, not only 1080x1920. X's documented API video limit is 1280x1024 max, portrait 720x1280. IG feed images must be 4:5 to 1.91:1. LinkedIn is MP4 3 s–30 min, ≤500 MB, uploaded as local bytes. Add maxRate/bufferSize to stay under 25 Mbps. Add colorSpace 'bt709', enforceAudioTrack:true, CORS-served local assets, and SSR-side webpackOverride/gl settings, since remotion.config.ts does not apply to SSR. Instagram JPEG image stories still need a public URL. The 5 s MP4 workaround works only through Facebook Login for Business resumable upload; images are not supported there. Audio-less story video acceptance is unverified.

### Output specs by platform (from the fact-check)

- Per-platform output sizes. A single 1080x1920 output does not fit every platform, and the template engine must render several sizes from one template. X's API best practices say video 'dimensions must be between 32x32 and 1280x1024' and recommend 720x1280 for portrait, H.264 High Profile, AAC-LC, 4:2:0, no open GOP, and at least 5000 kbps video and 128 kbps audio. A 1080x1920 story MP4 is out of spec for X, so render a 720x1280 variant or test first; real-world acceptance may differ from the docs. X images are capped at 5 MB, and JPG, PNG, GIF and WEBP are accepted. Video limits: 20 min / 8 GB for standard accounts, minimum 0.5 s, one video per post. Sources: https://docs.x.com/x-api/media/quickstart/best-practices ; https://docs.x.com/x-api/media/introduction
- Instagram feed images must be 4:5 to 1.91:1, so 9:16 stills cannot be feed posts. Carousels crop every item to the first image, 1:1 by default. The template registry needs size presets, such as 1080x1920 for story/reel and 1080x1350 for feed, with calculateMetadata choosing width and height per target. Sources: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media ; https://developers.facebook.com/docs/instagram-platform/content-publishing
- LinkedIn video (Videos API): MP4 only, 3 s to 30 min, 75 KB to 500 MB. Upload is multipart in 4 MB parts from local bytes, with no public URL needed. Permission: w_member_social for member posts. Sources: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api?view=li-lms-2026-09 (ms.date 2026-02-12, updated 2026-03-02). The same page notes that Marketing version 202510 sunsets on 2026-10-15, so pin a newer LinkedIn-Version header. So one encode can serve IG stories (≤60 s) and LinkedIn, while X needs its own profile.
- Bitrate ceiling. CRF 18–20 has no rate cap, and busy screen recordings or photo Ken Burns at 1080x1920 can exceed Instagram's 25 Mbps VBR limit. Pass maxRate (e.g. '20M') and bufferSize to renderMedia, both options exist since 4.0.78, or hardwareAcceleration with videoBitrate, which rules out CRF. Source: https://www.remotion.dev/docs/renderer/render-media
- Color space. Remotion 4 defaults colorSpace to 'default', which is the same as bt601, and 5.0 keeps 'default'. For HD social video, pass colorSpace:'bt709' and imageFormat 'png' for accurate conversion, otherwise colors may shift after Instagram or X re-encode the file. Source: https://www.remotion.dev/docs/renderer/render-media
- Silent renders have no audio track because enforceAudioTrack defaults to false. Text and image stories will be video-only. Whether the IG API accepts that is unverified, so set enforceAudioTrack:true to be safe. Source: https://www.remotion.dev/docs/renderer/render-media
- Settings in remotion.config.ts (enableScss, the GL renderer) do not apply to server-side rendering. Pullup must pass webpackOverride to bundle() and chromiumOptions.gl to renderStill and renderMedia. WebGL/Three.js templates need chromiumOptions.gl:'angle' in Remotion 4; the default null lets Chrome decide, and @remotion/three says Three.js does not render with the default. 'angle' becomes the default in 5.0, and angle has known memory leaks on long renders. Sources: https://www.remotion.dev/docs/gl-options ; https://www.remotion.dev/docs/three
- Assets must be served through staticFile() or from CORS-enabled URLs. Mario's images and clips in ~/Pullup must come from the Hono server (localhost:4500) with CORS headers, or be copied into the bundle's public folder before each render. This also affects the @remotion/player live preview in the SPA. Source: https://www.remotion.dev/docs/media/support
- HEVC screen recordings fall back to OffthreadVideo during rendering, and ProRes needs @mediabunny/prores. Remotion suggests validating with canDecode() and re-encoding on the backend if needed. Transcode uploads to H.264 on ingest for a predictable pipeline. Sources: https://www.remotion.dev/docs/media/fallback ; https://www.remotion.dev/docs/validating-user-videos
- IG containers expire if not published within 24 h. Poll status_code about once per minute for no more than 5 minutes. The limit is 100 API-published posts per 24 h. Filters and shopping tags are not supported, and the docs do not document stickers or music for API stories, so burn any 'sticker' look into the template. Source: https://developers.facebook.com/docs/instagram-platform/content-publishing
- Remotion 5.0 will require a licenseKey (or "free-license") on every render API call, enable WebGL by default, and change bundle() and getCompositions() to take an options object. Pin exact 4.0.x versions and plan a migration task. Source: https://www.remotion.dev/docs/5-0-migration

## Sources

- Local test, harness at /private/tmp/claude-501/-Users-mariosmaselli-Sites-tools/07ffe702-9c38-4ffe-91e4-88312a158b7b/scratchpad/bench/ (bench.js, worker.js, run.mjs)
- Local test (bench.js video=1 vs video=2)
- Local test (framemd5 comparisons; obo.html ramp test)
- mediabunny@1.60.0 source: dist/modules/src/media-source.js (CanvasSource.add) and sample.js (VideoSample canvas branch); https://mediabunny.dev/guide/media-sources
- npm registry (npm view mediabunny / mp4-muxer / @mediabunny/aac-encoder); https://github.com/Vanilagy/mediabunny
- https://mediabunny.dev/guide/output-formats ; https://mediabunny.dev/guide/media-sources ; mediabunny@1.60.0 src/isobmff/isobmff-boxes.ts (trak/edts)
- mediabunny@1.60.0 dist/modules/src/codec.js (buildVideoCodecString, AVC_LEVEL_TABLE); https://en.wikipedia.org/wiki/Advanced_Video_Coding (levels table); local ffprobe
- Local ffprobe / trace_headers / framemd5 on out/*.mp4 (ffmpeg 7.1.1)
- Local isConfigSupported probe; https://groups.google.com/a/chromium.org/g/chromium-reviews/c/jSbb3TRqSy4
- https://webcodecsfundamentals.org/basics/encoder/ (undated, no author)
- https://developer.mozilla.org/en-US/docs/Web/API/VideoFrame/VideoFrame ; https://www.w3.org/TR/webcodecs/
- https://webgl2fundamentals.org/webgl/lessons/webgl-tips.html
- https://gsap.com/docs/v3/GSAP/gsap.updateRoot()/ ; https://gsap.com/docs/v3/GSAP/gsap.ticker/ ; https://gsap.com/docs/v3/GSAP/Timeline/seek()/ ; https://gsap.com/docs/v3/GSAP/Timeline/totalTime()/ ; https://gsap.com/docs/v3/GSAP/gsap.globalTimeline/ ; local worker test
- https://gsap.com/standard-license ; npm view gsap
- https://unpkg.com/three@0.186.1/src/textures/VideoFrameTexture.js ; https://unpkg.com/three@0.186.1/src/core/Clock.js ; https://github.com/mrdoob/three.js/pull/30270 ; local webgpu.html test
- Local tests (va_30.mp4, ff_mux*.mp4); https://webkit.org/blog/17333/webkit-features-in-safari-26-0/ ; npm @mediabunny/aac-encoder README
- https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
- https://www.threads.com/@mosseri/post/DE-efFqyStv ; https://storrito.com/resources/how-instagrams-20-slide-carousels-work-and-what-the-new-limits-are/ ; https://postnitro.ai/blog/post/instagram-carousel-limit-20-photos-per-post-guide ; https://www.dreampixelforge.com/blog/instagram-post-size
- https://github.com/remotion-dev/remotion/blob/main/LICENSE.md ; https://www.remotion.pro/license ; npm view remotion / @remotion/three
- https://www.remotion.dev/docs/client-side-rendering/ ; https://www.remotion.dev/docs/client-side-rendering/how-it-works ; https://www.remotion.dev/docs/client-side-rendering/limitations ; https://www.remotion.dev/docs/client-side-rendering/telemetry ; https://www.remotion.dev/docs/gl-options ; https://www.remotion.dev/docs/three-canvas ; https://www.remotion.dev/docs/renderer/render-media
- Local puppeteer-core test; https://www.heygen.com/research/html-to-video (2026-06-22); https://github.com/heygen-com/hyperframes
- npm view @theatre/core time; https://github.com/theatre-js/theatre
- https://protectwise.github.io/troika/troika-three-text/ ; https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/fonts
- https://developer.chrome.com/blog/background_tabs ; local hidden.mjs test
