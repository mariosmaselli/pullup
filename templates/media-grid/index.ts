import * as THREE from 'three'
import type { TemplateFactory, VideoLayer } from '@shared/template.ts'
import {
  backgroundOptions,
  createBackgroundThree,
  type BackgroundThree,
} from '../_lib/background.ts'
import {
  coverScale,
  createRenderer,
  fullscreenScene,
  fullscreenVertex,
  videoTexture,
} from '../_lib/three.ts'
import {
  framing,
  planCamera,
  ZOOM_DEFAULT,
  type Cam,
  type CameraPath,
  type Ending,
  type Pace,
} from './camera.ts'
import { createCaption, MARGINS, type Caption } from './caption.ts'
import { layoutGrid, type Box, type CellShape, type GridLayout } from './layout.ts'
import { cellFragment, cellVertex, compositeFragment } from './shaders.ts'

// Grid: every medium in a cell of the same shape, on one flat plane under an orthographic camera.
// The camera opens on the whole grid, travels to a few cells in turn — in close, the cell leading
// the frame, pushing in slowly the whole time it holds — and pulls back to the overview (the reel
// loops) or ends on the first medium (Hero). Layout rules: layout.ts; framing, camera path and
// timing: camera.ts.
//
// Rendering: cells are quads with a rounded-rect SDF (crisp at any zoom), textures are mipmapped
// (images downsized to what the closest view needs). The grid is drawn into a transparent render
// target, then composited over the background with a deterministic motion blur along the camera's
// motion and the caption's scrim (shaders.ts). Videos are seeked (and uploaded) only while their
// cell is on screen; each clip's time runs in a loop of the piece's length that restarts while
// the cell is off screen (clipSchedule), so the reel's last frame matches its first.
//
// Background: the shared one (_lib/background.ts — a colour, or an image / video with size,
// position, darken and blur). It is fixed in screen space, drawn straight to the frame before the
// composite: the camera travels over it, and it is never motion-blurred with the grid.

// Design space is 1080 px wide; world units are design px at the overview.
const DW = 1080
// Share of a frame the virtual shutter stays open (144°, tent-weighted: a short, soft streak).
const SHUTTER = 0.4
// Overscan of the render target (design px per side), so the blur never samples past its edge.
const OVERSCAN = 48

interface Params {
  cellShape: CellShape
  columns: string
  gap: number
  radius: number
  zoom: number
  stops: string
  pace: Pace
  ending: Ending
  motionBlur: boolean
  focusX: number
  focusY: number
  typeSize: number
  color: string
}

const num = (v: unknown, fallback: number, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback

function readParams(raw: Record<string, unknown>): Params {
  const pick = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
    options.includes(v as T) ? (v as T) : fallback
  return {
    cellShape: pick(raw.cellShape, ['Square', 'Desktop', 'Mobile'], 'Desktop'),
    columns: typeof raw.columns === 'string' ? raw.columns : 'Auto',
    gap: num(raw.gap, 16, 0, 200),
    radius: num(raw.radius, 6, 0, 200),
    zoom: num(raw.zoom, ZOOM_DEFAULT, 0, 1),
    stops: typeof raw.stops === 'string' ? raw.stops : 'Auto',
    pace: pick(raw.pace, ['Smooth', 'Snappy'], 'Smooth'),
    ending: pick(raw.ending, ['Pull back', 'Hero'], 'Pull back'),
    motionBlur: raw.motionBlur !== false,
    focusX: num(raw.focusX, 0.5, 0, 1),
    focusY: num(raw.focusY, 0.5, 0, 1),
    typeSize: num(raw.typeSize, 84, 24, 200),
    color: typeof raw.color === 'string' ? raw.color : '#ffffff',
  }
}

const mediaGrid: TemplateFactory = (ctx) => {
  const p = readParams(ctx.params)
  const s = ctx.scale
  const W = ctx.width
  const H = ctx.height
  const DH = H / s
  const n = ctx.media.length
  const pad = Math.ceil(OVERSCAN * s)

  let renderer: THREE.WebGLRenderer
  let target: THREE.WebGLRenderTarget
  let bg: BackgroundThree | null = null
  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10)
  let composite: { scene: THREE.Scene; camera: THREE.Camera; material: THREE.ShaderMaterial }
  let caption: Caption | null = null
  let path: CameraPath
  let grid: GridLayout
  // The background colour: cleared to under the background, and tints a video cell's placeholder.
  const ground = new THREE.Color(backgroundOptions(ctx.params).color)
  const cells: {
    x: number
    y: number
    material: THREE.ShaderMaterial
    // clip: the clip's time at t (clipSchedule); visible: seeked this frame.
    video: {
      layer: VideoLayer
      sync: () => void
      clip: (t: number) => number
      visible: boolean
    } | null
  }[] = []
  const disposables: { dispose(): void }[] = []
  const bitmaps: ImageBitmap[] = []

  // Camera (centre, half extents) → uniforms.
  const toVec4 = (c: Cam, out: THREE.Vector4) => out.set(c.x, c.y, c.w / 2, (c.w * DH) / DW / 2)
  // A cell is on screen (with a 5% margin each side, for the blur) under camera c.
  const onScreen = (cell: { x: number; y: number }, c: Cam) =>
    Math.abs(cell.x - c.x) < c.w * 0.55 + grid.cellW / 2 &&
    Math.abs(cell.y - c.y) < ((c.w * DH) / DW) * 0.55 + grid.cellH / 2

  return {
    async setup() {
      renderer = createRenderer(ctx)
      const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy())
      bg = await createBackgroundThree(ctx, renderer)

      // ── Caption first: at Top / Bottom the grid is framed clear of it ─────────────────────
      caption = await createCaption(ctx, ctx.text.caption ?? '', {
        color: p.color,
        size: p.typeSize,
      })
      const m = MARGINS[ctx.aspect] ?? MARGINS['4:5']
      let top = m.top
      let bottom = DH - m.bottom
      if (caption?.reserved) {
        const r = caption.reserved
        if (r.top <= 0) top = Math.max(top, r.bottom / s)
        else bottom = Math.min(bottom, r.top / s)
      }
      const box: Box = { x: m.side, y: top, w: DW - m.side * 2, h: bottom - top }

      // ── Grid ──────────────────────────────────────────────────────────────────────────────
      const columns = p.columns === 'Auto' ? 'Auto' : Number(p.columns) || 'Auto'
      grid = layoutGrid(n, p.cellShape, columns, p.gap, box)

      const { overview, views, cellView, hero, mag, heroMag } = framing(grid, box, DW, DH, p.zoom)

      // ── Path ──────────────────────────────────────────────────────────────────────────────
      const plan = planCamera({
        duration: ctx.duration,
        grid,
        overview,
        views,
        cellView,
        hero,
        stops: p.stops === 'Auto' ? 'Auto' : Number(p.stops) || 'Auto',
        pace: p.pace,
        ending: p.ending,
        aspect: DH / DW,
        random: ctx.random,
      })
      path = plan.path
      const order = plan.order

      // ── Cells ─────────────────────────────────────────────────────────────────────────────
      // Quads overhang the cell so the SDF edge antialiases (at the overview 1 world unit is
      // one design px; close-ups only shrink pixels).
      const overhang = 4
      const geometry = new THREE.PlaneGeometry(grid.cellW + overhang, grid.cellH + overhang)
      disposables.push(geometry)
      const placeholder = ground
        .clone()
        .lerp(new THREE.Color(luminance(ground) > 0.2 ? 0x000000 : 0xffffff), 0.07)
      // The largest a cell ever gets on screen (canvas px): textures never need more.
      const largest = (i: number) =>
        grid.cellW * (i === 0 && p.ending === 'Hero' ? heroMag : mag) * 1.1 * s

      for (const cell of grid.cells) {
        const media = ctx.media[cell.index]!
        let texture: THREE.Texture
        let srcW: number
        let srcH: number
        let video: (typeof cells)[number]['video'] = null
        if (media.kind === 'video') {
          const layer = ctx.video(cell.index)
          const vt = videoTexture(layer)
          vt.texture.generateMipmaps = true
          vt.texture.minFilter = THREE.LinearMipmapLinearFilter
          vt.texture.anisotropy = maxAniso
          texture = vt.texture
          srcW = layer.width
          srcH = layer.height
          video = { layer, sync: vt.sync, clip: (t) => t, visible: false }
        } else {
          const bitmap = await ctx.image(cell.index)
          srcW = bitmap.width
          srcH = bitmap.height
          // Downsize to what the closest view shows (a 20-cell sheet would otherwise hold
          // hundreds of MB of full-size textures), flipped once for WebGL.
          const cover = coverScale(srcW, srcH, grid.cellW, grid.cellH)
          const k = Math.min(1, (largest(cell.index) / (srcW * cover.x)) * 1.15)
          const flipped = await createImageBitmap(bitmap, {
            imageOrientation: 'flipY',
            resizeWidth: Math.max(1, Math.round(srcW * k)),
            resizeHeight: Math.max(1, Math.round(srcH * k)),
            resizeQuality: 'high',
          })
          bitmaps.push(flipped)
          texture = new THREE.Texture(flipped)
          texture.flipY = false
          texture.colorSpace = THREE.SRGBColorSpace
          texture.minFilter = THREE.LinearMipmapLinearFilter
          texture.generateMipmaps = true
          texture.anisotropy = maxAniso
          texture.needsUpdate = true
        }
        disposables.push(texture)
        const cover = coverScale(srcW, srcH, grid.cellW, grid.cellH)
        const material = new THREE.ShaderMaterial({
          uniforms: {
            uMap: { value: texture },
            uSize: { value: new THREE.Vector2(grid.cellW, grid.cellH) },
            uRadius: { value: Math.min(p.radius, grid.cellW / 2, grid.cellH / 2) },
            uUvScale: { value: cover },
            // focusX 0 = left edge visible; focusY 0 = top edge (v runs bottom → top).
            uUvOffset: {
              value: new THREE.Vector2((1 - cover.x) * p.focusX, (1 - cover.y) * (1 - p.focusY)),
            },
            uDecode: { value: media.kind === 'video' ? 1 : 0 },
            uReady: { value: media.kind === 'video' ? 0 : 1 },
            uPlaceholder: { value: placeholder },
            uBleed: { value: p.gap < 0.5 ? 1 : 0 },
          },
          vertexShader: cellVertex,
          fragmentShader: cellFragment,
          transparent: true,
          depthTest: false,
          depthWrite: false,
        })
        disposables.push(material)
        const mesh = new THREE.Mesh(geometry, material)
        mesh.position.set(cell.x, cell.y, 0)
        scene.add(mesh)
        cells.push({ x: cell.x, y: cell.y, material, video })
      }

      // Clip timing: each clip plays around the first hold on its cell, and restarts while its
      // cell is off screen (see clipSchedule).
      const firstHold = new Map<number, { t0: number; t1: number }>()
      order.forEach((view, k) => {
        const members = view < 0 ? [grid.cells[0]!.index] : views[view]!.cells
        for (const m of members) if (!firstHold.has(m)) firstHold.set(m, path.holds[k]!)
      })
      const dt = 1 / 30
      const samples = Array.from({ length: Math.max(1, Math.round(ctx.duration / dt)) }, (_, k) =>
        path.at(k * dt)
      )
      // Screen speed (design px per sample): the pan plus the zoom at the frame's corner.
      const speed = samples.map((a, k) => {
        const b = samples[(k + 1) % samples.length]!
        const pan = (Math.hypot(b.x - a.x, b.y - a.y) * DW) / a.w
        return pan + Math.abs(Math.log(b.w / a.w)) * Math.hypot(DW, DH) * 0.5
      })
      cells.forEach((cell, i) => {
        const v = cell.video
        if (!v) return
        const visible = samples.map((c) => onScreen(cell, c))
        v.clip = clipSchedule(
          v.layer.duration,
          ctx.duration,
          visible,
          speed,
          firstHold.get(i) ?? null
        )
      })

      // ── Render target + composite ─────────────────────────────────────────────────────────
      target = new THREE.WebGLRenderTarget(W + pad * 2, H + pad * 2, {
        depthBuffer: false,
        generateMipmaps: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      })
      target.texture.colorSpace = THREE.SRGBColorSpace
      disposables.push(target)
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uScene: { value: target.texture },
          uNow: { value: new THREE.Vector4() },
          uFrom: { value: new THREE.Vector4() },
          uTo: { value: new THREE.Vector4() },
          uFrame: { value: new THREE.Vector2(W, H) },
          uPad: { value: new THREE.Vector2(pad, pad) },
          uScrimBand: { value: new THREE.Vector4(...(caption?.scrim.band ?? [0, 1, 2, 3])) },
          uScrimAlpha: { value: 0 },
          uScrimTint: { value: new THREE.Vector3(...(caption?.scrim.tint ?? [0, 0, 0])) },
        },
        vertexShader: fullscreenVertex,
        fragmentShader: compositeFragment,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      })
      disposables.push(material)
      composite = { ...fullscreenScene(material), material }
      // fullscreenScene's quad geometry is ours to free too.
      composite.scene.traverse((o) => {
        if (o instanceof THREE.Mesh) disposables.push(o.geometry)
      })
      renderer.compile(scene, camera)
    },

    update(t) {
      bg!.update(t)
      const now = path.at(t)
      const half = SHUTTER / 2 / ctx.fps
      const from = p.motionBlur ? path.at(t - half) : now
      const to = p.motionBlur ? path.at(t + half) : now

      // The render target's camera: the frame plus the overscan.
      const hw = (now.w / 2) * ((W + pad * 2) / W)
      const hh = ((now.w * DH) / DW / 2) * ((H + pad * 2) / H)
      camera.left = -hw
      camera.right = hw
      camera.top = hh
      camera.bottom = -hh
      camera.position.set(now.x, now.y, 5)
      camera.updateProjectionMatrix()
      const u = composite.material.uniforms
      toVec4(now, u.uNow!.value)
      toVec4(from, u.uFrom!.value)
      toVec4(to, u.uTo!.value)
      u.uScrimAlpha!.value = caption ? caption.scrim.alpha * caption.scrimLevel() : 0

      // Videos: only cells on screen (with a margin for the blur) are seeked.
      for (const cell of cells) {
        const v = cell.video
        if (!v) continue
        v.visible = onScreen(cell, now)
        if (v.visible) v.layer.seek(Math.min(Math.max(0, v.clip(t)), v.layer.duration))
      }
    },

    render() {
      for (const cell of cells) {
        const v = cell.video
        if (!v || !v.visible) continue
        v.sync()
        if (v.layer.frame) cell.material.uniforms.uReady!.value = 1
      }
      // Grid → transparent render target.
      renderer.setRenderTarget(target)
      renderer.setClearColor(0x000000, 0)
      renderer.clear()
      renderer.render(scene, camera)

      // Background (fixed, never motion-blurred), then the grid (blurred along the camera's
      // motion), then the caption.
      renderer.setRenderTarget(null)
      renderer.setClearColor(ground, 1)
      bg!.render()
      renderer.autoClear = false
      renderer.render(composite.scene, composite.camera)
      if (caption) {
        caption.draw()
        renderer.render(caption.scene, caption.camera)
      }
      renderer.autoClear = true
    },

    dispose() {
      bg?.dispose()
      disposables.forEach((d) => d.dispose())
      bitmaps.forEach((b) => b.close())
      caption?.dispose()
      renderer?.dispose()
    },
  }
}

export default mediaGrid

// Relative luminance in the linear working space — picks the placeholder tint.
function luminance(c: THREE.Color) {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}

// A clip's time at piece time t, for a clip of length L in a piece of length T. Time runs in a
// loop of T that restarts at a cut c, placed where the cell is off screen: the jump back is never
// seen, and the reel's last frame is the continuation of its first (a clip frozen at the end and
// playing at the start would jump at the loop). A clip shorter than the piece plays once per loop
// — around its cell's first hold when the camera visits it (else across the loop point, so it
// moves at the overview), starting and ending off screen where it can — and holds its first /
// last frame outside that. `visible`: the cell on screen at k / 30 s; `speed`: the camera's
// screen speed then (design px per frame). A cell that never leaves the screen (a sparse sheet)
// cuts at the camera's fastest moment instead, where the motion blur hides it — or, when the
// camera never moves fast, at the loop point (the old way: play from the start of the piece).
function clipSchedule(
  L: number,
  T: number,
  visible: boolean[],
  speed: number[],
  hold: { t0: number; t1: number } | null
): (t: number) => number {
  const N = visible.length
  const dt = T / N
  const hidden = (k: number) =>
    !visible[(k - 1 + N) % N] && !visible[((k % N) + N) % N] && !visible[(k + 1) % N]
  const at = (t: number) => Math.round(t / dt)
  let cuts: number[] = []
  for (let k = 0; k < N; k++) if (hidden(k)) cuts.push(k)
  const wrap = (x: number) => ((x % T) + T) % T
  if (!cuts.length) {
    // Fast enough to hide a cut (≈ a frame's width a second), else the loop point, as before.
    let fastest = 0
    for (let k = 1; k < N; k++) if (speed[k]! > speed[fastest]!) fastest = k
    cuts = [speed[fastest]! >= 36 ? fastest : 0]
  }
  // At most 48 candidate cuts, evenly through the off-screen moments.
  if (cuts.length > 48)
    cuts = Array.from({ length: 48 }, (_, i) => cuts[Math.floor((i * cuts.length) / 48)]!)
  const target = hold ? (hold.t0 + hold.t1) / 2 : 0 // unvisited: centred on the loop point
  if (L >= T) {
    // Any off-screen cut works; the one farthest from the hold (or the loop point).
    let best = cuts[0]! * dt
    let score = -1
    for (const k of cuts) {
      const d = Math.abs(wrap(k * dt - target + T / 2) - T / 2)
      if (d > score) {
        score = d
        best = k * dt
      }
    }
    const c = best
    return (t) => wrap(t - c)
  }
  let best = { c: 0, p: 0, score: -Infinity }
  const steps = Math.max(1, Math.round((T - L) / 0.1))
  for (const k of cuts) {
    const c = k * dt
    for (let j = 0; j <= steps; j++) {
      const p = ((T - L) * j) / steps
      // The playback window in piece time, [c + p, c + p + L] (mod T).
      let score = 0
      if (hold) {
        const h0 = wrap(hold.t0 - c)
        const h1 = wrap(hold.t1 - c)
        score += h0 <= h1 && h0 >= p && h1 <= p + L ? 4 : -4
      }
      if (!visible[at(wrap(c + p)) % N]) score += 1
      if (!visible[at(wrap(c + p + L)) % N]) score += 1
      const centre = wrap(c + p + L / 2)
      score -= (0.5 * Math.abs(wrap(centre - target + T / 2) - T / 2)) / T
      if (score > best.score) best = { c, p, score }
    }
  }
  const { c, p } = best
  return (t) => Math.min(L, Math.max(0, wrap(t - c) - p))
}
