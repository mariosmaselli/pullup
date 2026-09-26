import * as THREE from 'three'
import type { TemplateFactory, VideoLayer } from '@shared/template.ts'
import {
  backgroundOptions,
  createBackgroundThree,
  type BackgroundThree,
} from '../_lib/background.ts'
import {
  createBase,
  TEXT_PARAMS,
  textSettings,
  type BaseLayer,
  type Exit,
  type InkBox,
} from '../_lib/base.ts'
import { createBaseOverlay, type BaseOverlay } from '../_lib/base-three.ts'
import { FRAME_MARGINS, mediaRect, mediaSize } from '../_lib/layout.ts'
import { createRenderer, fullscreenScene, fullscreenVertex, videoTexture } from '../_lib/three.ts'
import {
  framing,
  planCamera,
  stillPath,
  ZOOM_DEFAULT,
  type Cam,
  type CameraPath,
  type Ending,
  type Pace,
} from './camera.ts'
import {
  layoutGrid,
  MAX_COLUMNS,
  MAX_ROWS,
  type Box,
  type CellShape,
  type GridLayout,
} from './layout.ts'
import { cellFragment, cellVertex, compositeFragment, INKS, SCRIMS } from './shaders.ts'

// Grid: rows × columns cells of one shape on one flat plane under an orthographic camera, the
// media repeated to fill every cell (layout.ts). The camera opens on the whole grid — centred on
// the frame, exactly, on the first frame — travels to a few cells in turn (in close, the cell
// leading the frame, pushing in slowly the whole time it holds; fresh media first) and pulls back
// to the overview (the reel loops) or ends on the first medium (Hero). Or it stays on the whole
// grid (Camera: Still — a JPEG when nothing else moves). Framing, camera path and timing:
// camera.ts.
//
// Type: the base layer every template shares (_lib/base.ts — caption, four corner labels, the
// type settings and animations), composited over the frame (_lib/base-three.ts). At Top / Bottom
// the grid is framed clear of it; the overview is laid out in that free area made symmetric, so
// the sheet sits centred on the frame. While the camera is in close, cells pass under the type:
// the legibility scrim darkens those cells only (shaders.ts), never the background — harder where
// they are light, so a screenshot's own big type recedes behind the caption — and the labels,
// quiet on the ground as on every template, turn solid as a cell slides under them. The looping
// ending pairs an entrance with its exit, so the type never pops off at the loop point.
//
// Rendering: cells are quads with a rounded-rect SDF (crisp at any zoom); each medium has one
// texture and material, shared by its cells; textures are mipmapped (images downsized to what the
// closest view needs). The grid is drawn into a transparent render target, then composited over
// the background with a deterministic motion blur along the camera's motion (shaders.ts). A clip
// is seeked (and uploaded) only while one of its cells is on screen; its cells play it in sync,
// in a loop of the piece's length that restarts while they are all off screen (clipSchedule), so
// the reel's last frame matches its first.
//
// Background: the shared one (_lib/background.ts — a colour, or an image / video with size,
// position, darken and blur). It is fixed in screen space, drawn straight to the frame before the
// composite: the camera travels over it, and it is never motion-blurred with the grid.

// Share of a frame the virtual shutter stays open (144°, tent-weighted: a short, soft streak).
const SHUTTER = 0.4
// Overscan of the render target (design px per side), so the blur never samples past its edge.
const OVERSCAN = 48
// Space between the type at the top / bottom and the grid (design px).
const TYPE_GAP = 48
// A cell fades into the scrim over this much overlap with the type (design px).
const SCRIM_REACH = 96
// A label turns solid / quiet over this long (s) as cells slide under it or away: its ground is
// averaged over the camera across that window (LABEL_TAPS samples) — a fast move carries a cell
// under a label within a frame, and the label would pop.
const LABEL_WINDOW = 0.3
const LABEL_TAPS = 7
// How much harder the scrim pulls content that stands out from its tint (shaders.ts): at the
// default gradient (0.55) a white page under the caption goes to ~#464646 instead of #7c7c7c, so
// a light screenshot's own big type recedes behind the caption; dark content is barely touched.
const SCRIM_COMPRESS = 1.8
// The overview is centred on the frame unless that leaves the grid less than this share of the
// free area's height (a very tall caption): then it sits in the free area.
const CENTRED_MIN = 0.5
// An entrance on the looping ending leaves the same way before the loop point.
const LOOP_EXIT: Record<string, Exit> = { Fade: 'Fade', Rise: 'Rise', Reveal: 'Rise' }

interface Params {
  cellShape: CellShape
  columns: number | 'Auto'
  rows: number | 'Auto'
  gap: number
  radius: number
  camera: 'Tour' | 'Still'
  zoom: number
  stops: string
  pace: Pace
  ending: Ending
  motionBlur: boolean
}

const num = (v: unknown, fallback: number, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback
const count = (v: unknown, max: number): number | 'Auto' => {
  const k = Number(v)
  return Number.isInteger(k) && k >= 1 && k <= max ? k : 'Auto'
}

function readParams(raw: Record<string, unknown>): Params {
  const pick = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
    options.includes(v as T) ? (v as T) : fallback
  return {
    cellShape: pick(raw.cellShape, ['Square', 'Desktop', 'Mobile'], 'Desktop'),
    columns: count(raw.columns, MAX_COLUMNS),
    rows: count(raw.rows, MAX_ROWS),
    gap: num(raw.gap, 16, 0, 200),
    radius: num(raw.radius, 6, 0, 200),
    camera: raw.camera === 'Still' ? 'Still' : 'Tour',
    zoom: num(raw.zoom, ZOOM_DEFAULT, 0, 1),
    stops: typeof raw.stops === 'string' ? raw.stops : 'Auto',
    pace: pick(raw.pace, ['Smooth', 'Snappy'], 'Smooth'),
    ending: pick(raw.ending, ['Pull back', 'Hero'], 'Pull back'),
    motionBlur: raw.motionBlur !== false,
  }
}

// One medium: its texture and material (shared by its cells), and its clip when it is a video.
interface Medium {
  material: THREE.ShaderMaterial
  cells: { x: number; y: number }[]
  // The part of a cell it covers (world units from the cell centre, y up).
  box: { x0: number; x1: number; y0: number; y1: number }
  video: {
    layer: VideoLayer
    sync: () => void
    clip: (t: number) => number // the clip's time at t (clipSchedule)
    visible: boolean // seeked this frame
  } | null
}

const mediaGrid: TemplateFactory = (ctx) => {
  const p = readParams(ctx.params)
  const s = ctx.scale
  const W = ctx.width
  const H = ctx.height
  // Design frame: 1080 on the short side.
  const DW = W / s
  const DH = H / s
  const n = ctx.media.length
  const pad = Math.ceil(OVERSCAN * s)
  const tour = p.camera === 'Tour' && ctx.kind === 'video' && ctx.duration > 0

  let renderer: THREE.WebGLRenderer
  let target: THREE.WebGLRenderTarget
  let bg: BackgroundThree | null = null
  let base: BaseLayer | null = null
  let overlay: BaseOverlay | null = null
  let gradient = 0
  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10)
  let composite: { scene: THREE.Scene; camera: THREE.Camera; material: THREE.ShaderMaterial }
  let path: CameraPath
  let grid: GridLayout
  // The background colour: cleared to under the background, and tints a video cell's placeholder.
  const ground = new THREE.Color(backgroundOptions(ctx.params).color)
  const media: Medium[] = []
  const disposables: { dispose(): void }[] = []
  const bitmaps: ImageBitmap[] = []
  // Uniforms every cell shares: the camera and the scrim bands (shaders.ts).
  const shared = {
    uCam: { value: new THREE.Vector4() },
    uFrame: { value: new THREE.Vector2(W, H) },
    uBands: { value: Array.from({ length: SCRIMS }, () => new THREE.Vector4(0, 1, 2, 3)) },
    uInks: { value: Array.from({ length: SCRIMS * INKS }, () => new THREE.Vector4()) },
    uStrength: { value: new Array<number>(SCRIMS).fill(0) },
    uReach: { value: SCRIM_REACH * s },
    uTint: { value: new THREE.Vector3() },
    uCompress: { value: SCRIM_COMPRESS },
  }

  // Camera (centre, half extents) → uniforms.
  const toVec4 = (c: Cam, out: THREE.Vector4) => out.set(c.x, c.y, c.w / 2, (c.w * DH) / DW / 2)
  // A cell is on screen (with a 5% margin each side, for the blur) under camera c.
  const onScreen = (cell: { x: number; y: number }, c: Cam) =>
    Math.abs(cell.x - c.x) < c.w * 0.55 + grid.cellW / 2 &&
    Math.abs(cell.y - c.y) < ((c.w * DH) / DW) * 0.55 + grid.cellH / 2

  // The camera across LABEL_WINDOW around this frame (set in update(t)).
  let cams: Cam[] = []
  // How much of a piece of type (canvas px) the media covers: the share of its ink box over a
  // cell (full from half) under each camera, averaged — a label turns solid as cells slide under.
  const pictureUnder = (ink: InkBox) => {
    const area = (ink.right - ink.left) * (ink.bottom - ink.top)
    if (!(area > 0) || !cams.length) return 0
    let sum = 0
    for (const cam of cams) {
      const k = W / cam.w // canvas px per world unit
      let covered = 0
      for (const medium of media) {
        const { x0, x1, y0, y1 } = medium.box
        for (const cell of medium.cells) {
          const left = W / 2 + (cell.x + x0 - cam.x) * k
          const right = W / 2 + (cell.x + x1 - cam.x) * k
          const top = H / 2 - (cell.y + y1 - cam.y) * k
          const bottom = H / 2 - (cell.y + y0 - cam.y) * k
          const w = Math.min(right, ink.right) - Math.max(left, ink.left)
          const h = Math.min(bottom, ink.bottom) - Math.max(top, ink.top)
          if (w > 0 && h > 0) covered += w * h
        }
      }
      sum += Math.min(1, covered / area / 0.5)
    }
    const u = sum / cams.length
    return u * u * (3 - 2 * u)
  }

  return {
    async setup() {
      renderer = createRenderer(ctx)
      const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy())
      bg = await createBackgroundThree(ctx, renderer)

      // ── Type first: at Top / Bottom the grid is framed clear of it ───────────────────────
      // The looping ending (Pull back) closes an entrance with its exit: the type leaves before
      // the loop point and comes back after it, instead of popping off at the cut.
      const params = typeParams(ctx.params)
      const st = textSettings(params)
      const loops = tour && p.ending === 'Pull back'
      const exit = loops && st.exit === 'None' ? LOOP_EXIT[st.animation] : undefined
      if (exit) params.exit = exit
      base = await createBase({ ...ctx, params })
      // Labels are quiet on the ground and solid over the cells passing under them.
      overlay = createBaseOverlay(ctx, base, { scrim: null, labels: pictureUnder })
      gradient = st.gradient
      base.scrims.slice(0, SCRIMS).forEach((scrim, i) => {
        shared.uBands.value[i]!.set(...scrim.band)
        scrim.inks.slice(0, INKS).forEach(({ left, top, right, bottom }, j) => {
          shared.uInks.value[i * INKS + j]!.set(left, top, right, bottom)
        })
      })
      shared.uTint.value.set(...base.tint)

      // The free area: the margins, clear of the type at the top and bottom (a Middle caption
      // sits over the grid). The overview is laid out in it made symmetric — centred.
      const m = FRAME_MARGINS[ctx.aspect] ?? FRAME_MARGINS['4:5']
      const { edges } = base
      const top = edges.top > 0 ? Math.max(m.top, edges.top / s + TYPE_GAP) : m.top
      const bottom =
        edges.bottom < H ? Math.min(DH - m.bottom, edges.bottom / s - TYPE_GAP) : DH - m.bottom
      const viewBox: Box = { x: m.side, y: top, w: DW - m.side * 2, h: Math.max(1, bottom - top) }
      const inset = Math.max(top, DH - bottom)
      const layoutBox: Box =
        DH - inset * 2 >= viewBox.h * CENTRED_MIN
          ? { x: m.side, y: inset, w: viewBox.w, h: DH - inset * 2 }
          : viewBox

      // ── Grid ──────────────────────────────────────────────────────────────────────────────
      grid = layoutGrid(n, p.cellShape, p.columns, p.rows, p.gap, layoutBox)
      // The Hero ending ends on the first medium: its cell nearest the centre (an edge cell's
      // close-up would show the sheet's edge).
      let heroCell = -1
      for (const cell of grid.cells) {
        if (cell.media !== 0) continue
        const best = grid.cells[heroCell]
        if (!best || Math.hypot(cell.x, cell.y) < Math.hypot(best.x, best.y) - 1e-6)
          heroCell = cell.index
      }
      heroCell = Math.max(0, heroCell)
      const { overview, views, cellView, hero, mag, heroMag } = framing(
        grid,
        layoutBox,
        viewBox,
        DW,
        DH,
        p.zoom,
        heroCell
      )

      // ── Path ──────────────────────────────────────────────────────────────────────────────
      let order: number[] = []
      if (tour) {
        const plan = planCamera({
          duration: ctx.duration,
          grid,
          overview,
          views,
          cellView,
          hero,
          heroCell,
          stops: p.stops === 'Auto' ? 'Auto' : Number(p.stops) || 'Auto',
          pace: p.pace,
          ending: p.ending,
          aspect: DH / DW,
          random: ctx.random,
        })
        path = plan.path
        order = plan.order
      } else {
        path = stillPath(overview)
      }

      // ── Media: one texture and material each, shared by its cells ─────────────────────────
      // Quads overhang the cell so the SDF edge antialiases (at the overview 1 world unit is
      // one design px; close-ups only shrink pixels).
      const overhang = 4
      const geometry = new THREE.PlaneGeometry(grid.cellW + overhang, grid.cellH + overhang)
      disposables.push(geometry)
      const placeholder = ground
        .clone()
        .lerp(new THREE.Color(luminance(ground) > 0.2 ? 0x000000 : 0xffffff), 0.07)
      // The most a medium is ever magnified (× the overview, where a world unit is a design px):
      // textures never need more.
      const closest = (i: number) => (tour ? (i === 0 && p.ending === 'Hero' ? heroMag : mag) : 1)
      const sizing = mediaSize(ctx.params)
      const { cellW, cellH } = grid
      const used = [...new Set(grid.cells.map((c) => c.media))].sort((a, b) => a - b)
      const byMedium = new Map<number, Medium>()

      for (const i of used) {
        const input = ctx.media[i]!
        let texture: THREE.Texture
        let srcW: number
        let srcH: number
        let video: Medium['video'] = null
        if (input.kind === 'video') {
          const layer = ctx.video(i)
          const vt = videoTexture(layer)
          vt.texture.generateMipmaps = true
          vt.texture.minFilter = THREE.LinearMipmapLinearFilter
          vt.texture.anisotropy = maxAniso
          texture = vt.texture
          srcW = layer.width
          srcH = layer.height
          video = { layer, sync: vt.sync, clip: () => 0, visible: false }
        } else {
          const bitmap = await ctx.image(i)
          srcW = bitmap.width
          srcH = bitmap.height
          // Downsize to what the closest view shows (a 20-cell sheet would otherwise hold
          // hundreds of MB of full-size textures), flipped once for WebGL.
          const rect = mediaRect(cellW, cellH, srcW, srcH, sizing)
          const k = Math.min(1, ((rect.w * closest(i) * 1.1 * s) / srcW) * 1.15)
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
        // The media's rect in the cell (Media size, scale, position; y down from the cell's
        // top-left) → cell-local world units (y up from its centre); the visible part is where
        // it overlaps the cell.
        const r = mediaRect(cellW, cellH, srcW, srcH, sizing)
        const left = -cellW / 2 + r.x
        const topY = cellH / 2 - r.y
        const x0 = Math.max(-cellW / 2, left)
        const x1 = Math.min(cellW / 2, left + r.w)
        const y0 = Math.max(-cellH / 2, topY - r.h)
        const y1 = Math.min(cellH / 2, topY)
        const hx = Math.max(0, (x1 - x0) / 2)
        const hy = Math.max(0, (y1 - y0) / 2)
        const covers = x0 <= -cellW / 2 + 1e-3 && x1 >= cellW / 2 - 1e-3
        const coversY = y0 <= -cellH / 2 + 1e-3 && y1 >= cellH / 2 - 1e-3
        const material = new THREE.ShaderMaterial({
          uniforms: {
            ...shared,
            uMap: { value: texture },
            uBox: { value: new THREE.Vector4((x0 + x1) / 2, (y0 + y1) / 2, hx, hy) },
            uMedia: { value: new THREE.Vector4(left, topY - r.h, r.w, r.h) },
            uRadius: { value: Math.min(p.radius, hx, hy) },
            uDecode: { value: input.kind === 'video' ? 1 : 0 },
            uReady: { value: input.kind === 'video' ? 0 : 1 },
            uPlaceholder: { value: placeholder },
            uBleed: { value: p.gap < 0.5 && covers && coversY ? 1 : 0 },
          },
          vertexShader: cellVertex,
          fragmentShader: cellFragment,
          transparent: true,
          depthTest: false,
          depthWrite: false,
        })
        disposables.push(material)
        const medium: Medium = { material, cells: [], box: { x0, x1, y0, y1 }, video }
        byMedium.set(i, medium)
        media.push(medium)
      }
      for (const cell of grid.cells) {
        const medium = byMedium.get(cell.media)!
        const mesh = new THREE.Mesh(geometry, medium.material)
        mesh.position.set(cell.x, cell.y, 0)
        scene.add(mesh)
        medium.cells.push({ x: cell.x, y: cell.y })
      }

      // Clip timing: each clip plays around the first hold on one of its cells, and restarts
      // while all its cells are off screen (see clipSchedule).
      if (ctx.duration > 0) {
        const firstHold = new Map<number, { t0: number; t1: number }>()
        order.forEach((view, k) => {
          const cells = view < 0 ? [heroCell] : views[view]!.cells
          for (const c of cells) {
            const m = grid.cells[c]!.media
            if (!firstHold.has(m)) firstHold.set(m, path.holds[k]!)
          }
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
        for (const i of used) {
          const medium = byMedium.get(i)!
          const v = medium.video
          if (!v) continue
          const visible = samples.map((c) => medium.cells.some((cell) => onScreen(cell, c)))
          v.clip = clipSchedule(
            v.layer.duration,
            ctx.duration,
            visible,
            speed,
            firstHold.get(i) ?? null
          )
        }
      }

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
          uNow: shared.uCam,
          uFrom: { value: new THREE.Vector4() },
          uTo: { value: new THREE.Vector4() },
          uFrame: { value: new THREE.Vector2(W, H) },
          uPad: { value: new THREE.Vector2(pad, pad) },
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
      base!.update(t)
      const now = path.at(t)
      cams = tour
        ? Array.from({ length: LABEL_TAPS }, (_, i) =>
            path.at(t + LABEL_WINDOW * (i / (LABEL_TAPS - 1) - 0.5))
          )
        : [now]
      const half = SHUTTER / 2 / ctx.fps
      const blur = tour && p.motionBlur
      const from = blur ? path.at(t - half) : now
      const to = blur ? path.at(t + half) : now

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
      toVec4(now, shared.uCam.value)
      toVec4(from, u.uFrom!.value)
      toVec4(to, u.uTo!.value)

      // The scrims fade in and out with the type.
      const level = gradient * base!.scrimLevel()
      const strength = shared.uStrength.value
      for (let i = 0; i < SCRIMS; i++) strength[i] = level * (base!.scrims[i]?.alpha ?? 0)

      // Videos: only clips with a cell on screen (with a margin for the blur) are seeked.
      for (const medium of media) {
        const v = medium.video
        if (!v) continue
        v.visible = medium.cells.some((cell) => onScreen(cell, now))
        if (v.visible) v.layer.seek(Math.min(Math.max(0, v.clip(t)), v.layer.duration))
      }
    },

    render() {
      for (const medium of media) {
        const v = medium.video
        if (!v || !v.visible) continue
        v.sync()
        if (v.layer.frame) medium.material.uniforms.uReady!.value = 1
      }
      // Grid → transparent render target.
      renderer.setRenderTarget(target)
      renderer.setClearColor(0x000000, 0)
      renderer.clear()
      renderer.render(scene, camera)

      // Background (fixed, never motion-blurred), then the grid (blurred along the camera's
      // motion), then the type.
      renderer.setRenderTarget(null)
      renderer.setClearColor(ground, 1)
      bg!.render()
      renderer.autoClear = false
      renderer.render(composite.scene, composite.camera)
      renderer.autoClear = true
      overlay!.render(renderer)
    },

    dispose() {
      bg?.dispose()
      overlay?.dispose()
      base?.dispose()
      disposables.forEach((d) => d.dispose())
      bitmaps.forEach((b) => b.close())
      renderer?.dispose()
    },
  }
}

export default mediaGrid

// The type settings, reading version 1's keys: it stored the caption's size and colour as
// `typeSize` / `color` (a builder frame keeps only changed settings), used while the base layer's
// keys are at their defaults.
function typeParams(raw: Record<string, unknown>): Record<string, unknown> {
  const params = { ...raw }
  if (typeof raw.typeSize === 'number' && raw.textSize === TEXT_PARAMS.textSize.default)
    params.textSize = raw.typeSize
  if (typeof raw.color === 'string' && raw.textColor === TEXT_PARAMS.textColor.default)
    params.textColor = raw.color
  return params
}

// Relative luminance in the linear working space — picks the placeholder tint.
function luminance(c: THREE.Color) {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}

// A clip's time at piece time t, for a clip of length L in a piece of length T. Time runs in a
// loop of T that restarts at a cut c, placed where the clip's cells are off screen: the jump back
// is never seen, and the reel's last frame is the continuation of its first (a clip frozen at the
// end and playing at the start would jump at the loop). A clip shorter than the piece plays once
// per loop — around the first hold on one of its cells when the camera visits it (else across the
// loop point, so it moves at the overview), starting and ending off screen where it can — and
// holds its first / last frame outside that. `visible`: a cell of the clip on screen at k / 30 s;
// `speed`: the camera's screen speed then (design px per frame). A clip that never leaves the
// screen (a sparse sheet) cuts at the camera's fastest moment instead, where the motion blur hides
// it — or, when the camera never moves fast, at the loop point (the old way: play from the start
// of the piece).
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
