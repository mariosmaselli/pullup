import * as THREE from 'three'

// A w×h rectangle with rounded corners as real geometry (no alpha, no custom shader): edges are
// antialiased by MSAA and the plane stays opaque, so built-in materials, fog and sorting just work.
// UVs span the full rectangle (0…1), like PlaneGeometry.
export function roundedRect(w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2)
  if (r <= 1e-4) return new THREE.PlaneGeometry(w, h)
  const x = -w / 2
  const y = -h / 2
  const shape = new THREE.Shape()
  shape.moveTo(x + r, y)
  shape.lineTo(x + w - r, y)
  shape.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false)
  shape.lineTo(x + w, y + h - r)
  shape.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false)
  shape.lineTo(x + r, y + h)
  shape.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false)
  shape.lineTo(x, y + r)
  shape.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false)
  const geometry = new THREE.ShapeGeometry(shape, 12)
  const pos = geometry.attributes.position!
  const uv = geometry.attributes.uv!
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, (pos.getX(i) - x) / w, (pos.getY(i) - y) / h)
  }
  uv.needsUpdate = true
  return geometry
}

// A soft rounded-rect shadow as a greyscale alpha map (white = opaque). The quad it goes on is
// (w + 2·pad) × (h + 2·pad) world units.
export function shadowTexture(w: number, h: number, r: number, pad: number) {
  const ppu = 160 // texture pixels per world unit
  const cw = Math.ceil((w + pad * 2) * ppu)
  const ch = Math.ceil((h + pad * 2) * ppu)
  const canvas = new OffscreenCanvas(cw, ch)
  const g = canvas.getContext('2d', { alpha: false })!
  g.fillStyle = '#000'
  g.fillRect(0, 0, cw, ch)
  // Draw the shape off-canvas and let only its blurred shadow land inside.
  g.shadowColor = '#fff'
  // Canvas blur sigma is shadowBlur / 2; keep ~3σ inside the padding so the quad edge is clean.
  g.shadowBlur = pad * ppu * 0.6
  g.shadowOffsetX = cw
  g.fillStyle = '#fff'
  g.beginPath()
  g.roundRect(pad * ppu - cw, pad * ppu, w * ppu, h * ppu, r * ppu)
  g.fill()
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.NoColorSpace
  return texture
}
