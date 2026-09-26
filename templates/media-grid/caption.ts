import * as THREE from 'three'
import type { Aspect, TemplateContext, TextLayout } from '@shared/template.ts'
import { textBlockY, textLineX, textPlacement } from '../_lib/layout.ts'
import { STORY_TYPE } from '../_lib/text.ts'

// The optional caption: Mario's story type (PP Neue Montreal, _lib/text.ts STORY_TYPE) placed by
// TEXT_POSITION_PARAMS, drawn with canvas 2D on a transparent layer and composited over the grid
// as a screen-space quad. Each line rises out of its own mask (values tweened on ctx.timeline()).
// Lines are balanced (no orphan on the last line). At Top / Bottom the grid is framed clear of it
// (reserved); while the camera is in close, cells pass under it, so a soft scrim darkens the cells
// there — only the cells: the composite applies it to the grid layer (`scrim`), so the background
// is never touched and the type never sits on a stock lower-third band.

export const CAPTION_FAMILY = 'PP Neue Montreal'

// Design px. Stories keep clear of Instagram's header and reply bar (Mario's 160 px bottom
// margin, mirrored at the top); feed posts sit on the 40 px margin.
export const MARGINS: Record<Aspect, { side: number; top: number; bottom: number }> = {
  '9:16': { side: STORY_TYPE.side, top: 160, bottom: STORY_TYPE.bottom },
  '4:5': { side: STORY_TYPE.side, top: 40, bottom: 40 },
  '1:1': { side: STORY_TYPE.side, top: 40, bottom: 40 },
  '16:9': { side: STORY_TYPE.side, top: 40, bottom: 40 },
}

// Space between the caption's line boxes and the grid (design px).
const GAP = 48
// Scrim: strength, and how far it fades in past the caption's edge (design px).
const SCRIM = { alpha: 0.55, fade: 120 }
const MIDDLE = { alpha: 0.4, fade: 260 }
const DARK = [16, 16, 16] as const
const LIGHT = [242, 241, 236] as const

function luminance(hex: string) {
  const c = new THREE.Color(hex) // linear working space
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}

// Where the grid darkens under the type, in canvas px from the top: full strength between b and
// c, easing (smoothstep) to nothing at a and d. tint: sRGB 0–1.
export interface Scrim {
  band: [number, number, number, number]
  alpha: number
  tint: [number, number, number]
}

export interface Caption {
  // Canvas px the caption's line boxes occupy (plus the gap to the grid) — the grid's box
  // shrinks by this at Top / Bottom; null at Middle (the type sits over the grid).
  reserved: { top: number; bottom: number } | null
  scrim: Scrim
  // The scrim's fade-in (0–1, tweened on the timeline): read it in update().
  scrimLevel(): number
  scene: THREE.Scene
  camera: THREE.OrthographicCamera
  // Redraws when the reveal changed; call from render().
  draw(): void
  dispose(): void
}

export async function createCaption(
  ctx: TemplateContext,
  text: string,
  options: { color: string; size: number }
): Promise<Caption | null> {
  const body = text.trim()
  if (!body) return null
  await ctx.font(CAPTION_FAMILY)
  const s = ctx.scale
  const W = ctx.width
  const H = ctx.height
  const m = MARGINS[ctx.aspect] ?? MARGINS['4:5']
  const side = m.side * s
  const { position, align } = textPlacement(ctx.params)

  let size = options.size * s
  let layout: TextLayout
  const layoutAt = (maxWidth: number) =>
    ctx.layoutText(body, {
      family: CAPTION_FAMILY,
      size,
      lineHeight: STORY_TYPE.lineHeight,
      maxWidth,
      letterSpacing: STORY_TYPE.tracking * size,
    })
  // A long caption at a large size shrinks until it takes at most 40% of the frame.
  for (;;) {
    layout = layoutAt(W - side * 2)
    if (layout.height <= H * 0.4 || size <= 32 * s) break
    size *= 0.94
  }
  // Balance: the narrowest measure that keeps the same number of lines, so the last line is never
  // an orphan ('Selected work, 2024 —' / '2026' becomes 'Selected work,' / '2024 — 2026').
  if (layout.lines.length > 1) {
    const count = layout.lines.length
    let lo = layout.width / count
    let hi = layout.width
    for (let i = 0; i < 16 && hi - lo > 0.5; i++) {
      const mid = (lo + hi) / 2
      if (layoutAt(mid).lines.length > count) lo = mid
      else hi = mid
    }
    layout = layoutAt(Math.ceil(hi))
  }
  const tracking = STORY_TYPE.tracking * size
  const top = textBlockY(H, layout.height, position, { top: m.top * s, bottom: m.bottom * s })
  const bottom = top + layout.height
  const lineX = layout.lines.map((line) => textLineX(W, line.width, align, side))
  const gap = GAP * s
  const reserved =
    position === 'Bottom'
      ? { top: top - gap, bottom: H }
      : position === 'Top'
        ? { top: 0, bottom: bottom + gap }
        : null

  // Transparent layer: CPU-rasterised (willReadFrequently) so renders are reproducible.
  const canvas = new OffscreenCanvas(W, H)
  const g = canvas.getContext('2d', { willReadFrequently: true })!
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.generateMipmaps = false
  texture.minFilter = THREE.LinearFilter
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
  const geometry = new THREE.PlaneGeometry(W, H)
  const scene = new THREE.Scene()
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(W / 2, H / 2, 0)
  scene.add(mesh)
  const camera = new THREE.OrthographicCamera(0, W, H, 0, -1, 1)

  // Scrim tint: whichever ground gives the type more contrast. Bottom / Top: from the caption's
  // edge (faded over SCRIM.fade) to the frame edge; Middle: the type sits over the grid all the
  // time, so a bar would read as a stripe across it — a soft bell instead, lighter and wider,
  // darkest behind the lines.
  const tint = luminance(options.color) > 0.18 ? DARK : LIGHT
  const lh = layout.lineHeight
  const fade = SCRIM.fade * s
  const reach = MIDDLE.fade * s
  const scrim: Scrim = {
    band:
      position === 'Bottom'
        ? [top - fade, top + lh * 0.5, H + 1, H + 2]
        : position === 'Top'
          ? [-2, -1, bottom - lh * 0.5, bottom + fade]
          : [top - reach, top, bottom, bottom + reach],
    alpha: position === 'Middle' ? MIDDLE.alpha : SCRIM.alpha,
    tint: [tint[0] / 255, tint[1] / 255, tint[2] / 255],
  }

  // Reveal: each line rises out of a mask that hugs it, expo.out, staggered.
  const lines = layout.lines.map(() => ({ v: 0 }))
  const scrimIn = { v: 0 }
  const tl = ctx.timeline()
  const start = 0.35
  tl.to(scrimIn, { v: 1, duration: 0.9, ease: 'power2.out' }, Math.max(0, start - 0.2))
  lines.forEach((line, i) =>
    tl.to(line, { v: 1, duration: 1.1, ease: 'expo.out' }, start + i * 0.09)
  )

  const above = size * 0.2 // accents / ascenders above the line box
  const below = size * 0.3 // descenders
  const maskH = layout.lineHeight + above + below
  let key = ''

  return {
    reserved,
    scrim,
    scrimLevel: () => scrimIn.v,
    scene,
    camera,
    draw() {
      const next = lines.map((l) => l.v.toFixed(4)).join(',')
      if (next === key) return
      key = next
      g.clearRect(0, 0, W, H)
      g.save()
      g.font = layout.font
      g.letterSpacing = `${tracking}px`
      g.textBaseline = 'top'
      g.fillStyle = options.color
      layout.lines.forEach((line, i) => {
        const r = lines[i]!.v
        if (r <= 0 || !line.words.length) return
        const y = top + line.y
        g.save()
        g.beginPath()
        g.rect(0, y - above, W, maskH)
        g.clip()
        const dy = (1 - r) * maskH
        for (const word of line.words) g.fillText(word.text, lineX[i]! + word.x, y + dy)
        g.restore()
      })
      g.restore()
      texture.needsUpdate = true
    },
    dispose() {
      texture.dispose()
      material.dispose()
      geometry.dispose()
    },
  }
}
