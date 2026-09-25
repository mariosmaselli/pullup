import * as THREE from 'three'
import type { TextLayout } from '@shared/template.ts'

// The caption (plus a soft scrim in the background colour behind it) drawn with canvas 2D into a
// band at the bottom of the frame and composited over the 3D scene as a screen-space quad.
// Each line rises out of its own mask (the reveal values come from the GSAP timeline).
export class CaptionOverlay {
  readonly scene = new THREE.Scene()
  readonly camera: THREE.OrthographicCamera
  private canvas: OffscreenCanvas
  private g: OffscreenCanvasRenderingContext2D
  private texture: THREE.CanvasTexture<OffscreenCanvas>
  private material: THREE.MeshBasicMaterial
  private geometry: THREE.PlaneGeometry
  private key = ''

  constructor(
    private layout: TextLayout,
    private o: {
      width: number
      height: number
      // Canvas px: the band starts at `bandTop` and runs to the bottom of the frame.
      bandTop: number
      // Caption top-left (canvas px, frame coordinates).
      x: number
      top: number
      letterSpacing: number
      color: string
      scrimColor: string
      scrimAlpha: number
      // Where the scrim gradient starts (fully transparent) and reaches full strength.
      scrimFrom: number
      scrimTo: number
    }
  ) {
    const bandH = Math.ceil(o.height - o.bandTop)
    this.canvas = new OffscreenCanvas(o.width, bandH)
    this.g = this.canvas.getContext('2d')!
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.generateMipmaps = false
    this.texture.minFilter = THREE.LinearFilter
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
    this.geometry = new THREE.PlaneGeometry(o.width, bandH)
    const mesh = new THREE.Mesh(this.geometry, this.material)
    mesh.position.set(o.width / 2, bandH / 2, 0)
    this.scene.add(mesh)
    // Pixel camera: x right, y up, origin bottom-left.
    this.camera = new THREE.OrthographicCamera(0, o.width, o.height, 0, -1, 1)
  }

  // reveal[i] in 0…1 per line; scrim in 0…1. Redraws only when something visibly changed.
  draw(reveal: number[], scrim: number) {
    const key = reveal.map((r) => r.toFixed(4)).join(',') + '|' + scrim.toFixed(3)
    if (key === this.key) return
    this.key = key
    const { g, layout, o } = this
    const band = o.bandTop
    g.clearRect(0, 0, this.canvas.width, this.canvas.height)

    if (scrim > 0 && o.scrimAlpha > 0) {
      const gradient = g.createLinearGradient(0, o.scrimFrom - band, 0, o.scrimTo - band)
      gradient.addColorStop(0, withAlpha(o.scrimColor, 0))
      gradient.addColorStop(0.55, withAlpha(o.scrimColor, o.scrimAlpha * scrim * 0.6))
      gradient.addColorStop(1, withAlpha(o.scrimColor, o.scrimAlpha * scrim))
      g.fillStyle = gradient
      g.fillRect(0, o.scrimFrom - band, this.canvas.width, this.canvas.height)
    }

    g.save()
    g.font = layout.font
    g.letterSpacing = `${o.letterSpacing}px`
    g.textBaseline = 'top'
    g.fillStyle = o.color
    const above = layout.size * 0.2 // room for accents/ascenders above the line box
    const below = layout.size * 0.3 // and for descenders below it
    const maskH = layout.lineHeight + above + below
    layout.lines.forEach((line, li) => {
      const r = reveal[li] ?? 1
      if (r <= 0 || !line.words.length) return
      const lineTop = o.top + line.y - band
      g.save()
      g.beginPath()
      g.rect(0, lineTop - above, this.canvas.width, maskH)
      g.clip()
      const dy = (1 - r) * maskH
      for (const word of line.words) g.fillText(word.text, o.x + line.x + word.x, lineTop + dy)
      g.restore()
    })
    g.restore()
    this.texture.needsUpdate = true
  }

  dispose() {
    this.texture.dispose()
    this.material.dispose()
    this.geometry.dispose()
  }
}

function withAlpha(color: string, alpha: number) {
  const { r, g, b } = new THREE.Color(color).getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace)
  const to255 = (v: number) => Math.round(v * 255)
  return `rgba(${to255(r)}, ${to255(g)}, ${to255(b)}, ${Math.max(0, Math.min(1, alpha))})`
}
