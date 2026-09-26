import type * as THREE from 'three'
import type { ParamSpec, TemplateContext, TemplateMeta } from '@shared/template.ts'
import { mediaRect, type Rect } from './layout.ts'

// Backgrounds: a plain colour, or an image / video from the library (TemplateInputs.background,
// resolved as ctx.background) drawn behind everything else. Spread BACKGROUND_PARAMS into
// meta.params — Pullup then offers the Background picker for the template — and draw it first:
//
//   canvas 2D   const bg = createBackground2D(ctx)                  (in setup)
//               update(t) { bg.update(t) }   render() { bg.draw(g); …your frame… }
//
//   three.js    const bg = await createBackgroundThree(ctx, renderer) (in setup)
//               scene.add(bg.mesh)  — always drawn first, behind everything, at any camera
//               update(t) { bg.update(t) }   render() { bg.sync(); renderer.render(scene, camera) }
//
// Video backgrounds hold their last frame past the clip's end (like media, see the README): a
// loop would cut visibly mid-reel. They are only decoded while update() seeks them — skip
// bg.update(t) when something opaque covers the frame. Everything here depends only on t and the
// params (no randomness, one fixed blur recipe), so renders are reproducible: two exports of the
// same inputs decode to identical frames.
//
// This file must stay light at module level (meta.ts files import BACKGROUND_PARAMS on the main
// thread): three.js is only loaded inside createBackgroundThree().

export const BACKGROUND_PARAMS = {
  background: { type: 'color', label: 'Background', default: '#101010' },
  backgroundFit: {
    type: 'select',
    label: 'Background size',
    options: ['Fill', 'Fit'],
    default: 'Fill',
  },
  backgroundScale: {
    type: 'number',
    label: 'Background scale',
    min: 0.5,
    max: 2,
    step: 0.05,
    default: 1,
  },
  backgroundX: {
    type: 'number',
    label: 'Background left–right',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.5,
  },
  backgroundY: {
    type: 'number',
    label: 'Background top–bottom',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.5,
  },
  backgroundDarken: {
    type: 'number',
    label: 'Background darken',
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
  },
  // Gaussian standard deviation, design px (1080 wide).
  backgroundBlur: {
    type: 'number',
    label: 'Background blur',
    min: 0,
    max: 40,
    step: 1,
    default: 0,
  },
} satisfies Record<string, ParamSpec>

export type BackgroundKey = keyof typeof BACKGROUND_PARAMS

// The settings that only do something once an image or video is chosen (the UI shows them then).
export const BACKGROUND_MEDIA_KEYS: BackgroundKey[] = [
  'backgroundFit',
  'backgroundScale',
  'backgroundX',
  'backgroundY',
  'backgroundDarken',
  'backgroundBlur',
]

// Does the template take a background image/video? (It spread BACKGROUND_PARAMS into its params.)
export const takesBackground = (meta: TemplateMeta) =>
  !!meta.params && BACKGROUND_MEDIA_KEYS.every((key) => key in meta.params!)

export interface BackgroundOptions {
  color: string
  fit: 'Fill' | 'Fit'
  scale: number
  x: number
  y: number
  darken: number
  // Design px.
  blur: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const num = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

// Reads the BACKGROUND_PARAMS values, tolerating missing or stale ones (anything but 'Fit' is Fill).
export function backgroundOptions(params: Record<string, unknown>): BackgroundOptions {
  return {
    color: typeof params.background === 'string' ? params.background : '#101010',
    fit: params.backgroundFit === 'Fit' ? 'Fit' : 'Fill',
    scale: clamp(num(params.backgroundScale, 1), 0.05, 10),
    x: clamp(num(params.backgroundX, 0.5), 0, 1),
    y: clamp(num(params.backgroundY, 0.5), 0, 1),
    darken: clamp(num(params.backgroundDarken, 0), 0, 1),
    blur: clamp(num(params.backgroundBlur, 0), 0, 200),
  }
}

type Ctx2D = OffscreenCanvasRenderingContext2D
type Frame = ImageBitmap | VideoFrame

const sizeOf = (frame: Frame) =>
  'displayWidth' in frame
    ? { w: frame.displayWidth, h: frame.displayHeight }
    : { w: frame.width, h: frame.height }

// The blur's edge: the media is extended this many sigmas past the frame, so the blur never pulls
// the ground colour (or transparency) in at the frame's edges.
const OVERSCAN = 3

// Paints the media into `bounds` (frame coordinates, may reach past the frame): the ground colour,
// the media at `rect`, then — on every side where the media reaches the frame's edge — its edge
// pixels stretched out to `bounds` (clamp to edge), and the darkening over what the media covers.
// Media that sits inside the frame (Fit, scaled down) keeps its edges on the ground.
function paint(
  g: Ctx2D,
  frame: Frame | null,
  rect: Rect,
  W: number,
  H: number,
  bounds: { x0: number; y0: number; x1: number; y1: number },
  o: BackgroundOptions
) {
  const { x0, y0, x1, y1 } = bounds
  g.fillStyle = o.color
  g.fillRect(x0, y0, x1 - x0, y1 - y0)
  if (!frame) return
  const { w: sw, h: sh } = sizeOf(frame)
  if (!(sw > 0 && sh > 0)) return
  const eps = 0.5
  const reach = {
    left: rect.x <= eps,
    top: rect.y <= eps,
    right: rect.x + rect.w >= W - eps,
    bottom: rect.y + rect.h >= H - eps,
  }
  // Columns and rows of a 3×3 grid: [dest from, dest to, source from, source size].
  const cols: ([number, number, number, number] | null)[] = [
    reach.left && rect.x > x0 ? [x0, rect.x, 0, 1] : null,
    [rect.x, rect.x + rect.w, 0, sw],
    reach.right && rect.x + rect.w < x1 ? [rect.x + rect.w, x1, sw - 1, 1] : null,
  ]
  const rows: ([number, number, number, number] | null)[] = [
    reach.top && rect.y > y0 ? [y0, rect.y, 0, 1] : null,
    [rect.y, rect.y + rect.h, 0, sh],
    reach.bottom && rect.y + rect.h < y1 ? [rect.y + rect.h, y1, sh - 1, 1] : null,
  ]
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = 'high'
  for (const row of rows) {
    if (!row) continue
    for (const col of cols) {
      if (!col) continue
      g.drawImage(
        frame,
        col[2],
        row[2],
        col[3],
        row[3],
        col[0],
        row[0],
        col[1] - col[0],
        row[1] - row[0]
      )
    }
  }
  if (o.darken > 0) {
    const left = reach.left ? x0 : rect.x
    const top = reach.top ? y0 : rect.y
    const right = reach.right ? x1 : rect.x + rect.w
    const bottom = reach.bottom ? y1 : rect.y + rect.h
    g.fillStyle = `rgba(0, 0, 0, ${o.darken.toFixed(4)})`
    g.fillRect(left, top, right - left, bottom - top)
  }
}

// A Gaussian blur of the painted background (canvas `filter: blur()`, the same in preview and
// export). It works at a reduced resolution — a blur has no detail to lose; at least 4 px sigma,
// or full size for small blurs — over an overscan margin, and is scaled back up when drawn. Both
// canvases stay GPU-backed: blurring a video frame each frame costs ~1 ms there, ~20 ms on the CPU
// (the frame would be read back first), and the output is identical from run to run.
function blurLayer(W: number, H: number, sigma: number) {
  const margin = Math.ceil(sigma * OVERSCAN)
  const f = clamp(4 / sigma, 0.25, 1)
  const lw = Math.ceil((W + margin * 2) * f)
  const lh = Math.ceil((H + margin * 2) * f)
  const flat = new OffscreenCanvas(lw, lh)
  const blurred = new OffscreenCanvas(lw, lh)
  const fg = flat.getContext('2d', { alpha: false })!
  const bg = blurred.getContext('2d', { alpha: false })!
  return {
    compose(frame: Frame | null, rect: Rect, o: BackgroundOptions) {
      fg.setTransform(f, 0, 0, f, margin * f, margin * f)
      paint(fg, frame, rect, W, H, { x0: -margin, y0: -margin, x1: W + margin, y1: H + margin }, o)
      bg.filter = `blur(${(sigma * f).toFixed(3)}px)`
      bg.drawImage(flat, 0, 0)
    },
    draw(g: Ctx2D) {
      g.imageSmoothingEnabled = true
      g.imageSmoothingQuality = 'high'
      g.drawImage(blurred, margin * f, margin * f, W * f, H * f, 0, 0, W, H)
    },
    dispose() {
      flat.width = flat.height = blurred.width = blurred.height = 0
    },
  }
}

export interface Background2D {
  // A background image/video is set (else draw() is the plain colour).
  readonly media: boolean
  // Changes whenever draw() would paint something different (the video frame moved on).
  readonly version: number
  // Seeks a video background to t (held on its last frame). Call it from update().
  update(t: number): void
  // Paints the whole frame: colour, media, darkening, blur. Draw it first in render().
  draw(g: Ctx2D): void
  dispose(): void
}

// The background for a canvas 2D template (call in setup; ctx.background is loaded by then).
export function createBackground2D(ctx: TemplateContext): Background2D {
  const o = backgroundOptions(ctx.params)
  const source = ctx.background
  const W = ctx.width
  const H = ctx.height
  const rect: Rect = source
    ? mediaRect(W, H, source.width, source.height, {
        size: o.fit,
        scale: o.scale,
        focusX: o.x,
        focusY: o.y,
      })
    : { x: 0, y: 0, w: W, h: H }
  const sigma = o.blur * ctx.scale
  const blur = source && sigma >= 0.5 ? blurLayer(W, H, sigma) : null
  const frameOf = () => source?.image ?? source?.video?.frame ?? null
  let composed = -1 // the video version in the blur layer

  // An image is blurred once, here; a video whenever its frame changes.
  if (blur && source?.image) {
    blur.compose(source.image, rect, o)
    composed = 0
  }

  return {
    media: !!source,
    get version() {
      return source?.video?.version ?? 0
    },

    update(t) {
      const video = source?.video
      if (video) video.seek(Math.min(t, video.duration))
    },

    draw(g) {
      g.save()
      g.setTransform(1, 0, 0, 1, 0, 0)
      g.globalAlpha = 1
      g.globalCompositeOperation = 'source-over'
      g.filter = 'none'
      const frame = frameOf()
      if (blur && frame) {
        const version = source?.video?.version ?? 0
        if (version !== composed) {
          blur.compose(frame, rect, o)
          composed = version
        }
        blur.draw(g)
      } else {
        paint(g, frame, rect, W, H, { x0: 0, y0: 0, x1: W, y1: H }, o)
      }
      g.restore()
    },

    dispose() {
      blur?.dispose()
    },
  }
}

export interface BackgroundThree {
  // A full-frame quad in clip space: add it to your scene (it draws first, behind everything,
  // whatever the camera) or render `scene` with `camera` before your own.
  mesh: THREE.Mesh
  scene: THREE.Scene
  camera: THREE.OrthographicCamera
  readonly media: boolean
  update(t: number): void
  // Uploads the background when it changed (a new video frame). Call it first in render().
  sync(): void
  // sync() + draw the background alone, clearing the frame: for templates that render their
  // scene afterwards with renderer.autoClear = false.
  render(): void
  dispose(): void
}

// The background for a three.js template. It is painted with the same canvas code as the 2D one
// (identical look, CPU blur) and uploaded as an sRGB texture, so it needs no colour handling:
// the material decodes it and ends with <colorspace_fragment> like any image texture.
export async function createBackgroundThree(
  ctx: TemplateContext,
  renderer: THREE.WebGLRenderer
): Promise<BackgroundThree> {
  const T = await import('three')
  const flat = createBackground2D(ctx)
  // Without media the frame is one colour: a 1×1 texture.
  const canvas = flat.media ? new OffscreenCanvas(ctx.width, ctx.height) : new OffscreenCanvas(1, 1)
  const g = canvas.getContext('2d', { alpha: false })!
  const texture = new T.CanvasTexture(canvas)
  texture.colorSpace = T.SRGBColorSpace
  texture.minFilter = T.LinearFilter
  texture.magFilter = T.LinearFilter
  texture.generateMipmaps = false
  const material = new T.ShaderMaterial({
    uniforms: { map: { value: texture } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      varying vec2 vUv;
      void main() {
        gl_FragColor = vec4(texture2D(map, vUv).rgb, 1.0);
        #include <colorspace_fragment>
      }
    `,
    depthTest: false,
    depthWrite: false,
  })
  const mesh = new T.Mesh(new T.PlaneGeometry(2, 2), material)
  mesh.frustumCulled = false
  mesh.renderOrder = Number.MIN_SAFE_INTEGER
  const scene = new T.Scene()
  scene.add(mesh)
  const camera = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  let drawn = -1

  const sync = () => {
    if (flat.version === drawn) return
    drawn = flat.version
    flat.draw(g)
    texture.needsUpdate = true
  }

  return {
    mesh,
    scene,
    camera,
    media: flat.media,
    update: (t) => flat.update(t),
    sync,
    render() {
      sync()
      const autoClear = renderer.autoClear
      renderer.autoClear = true
      renderer.render(scene, camera)
      renderer.autoClear = autoClear
    },
    dispose() {
      flat.dispose()
      texture.dispose()
      material.dispose()
      mesh.geometry.dispose()
      canvas.width = canvas.height = 0
    },
  }
}
