import * as THREE from 'three'
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// Corner radii: [top-left, top-right, bottom-right, bottom-left]. 0 = square corner.
export type Radii = number | [number, number, number, number]

const corners = (r: Radii): [number, number, number, number] =>
  typeof r === 'number' ? [r, r, r, r] : r

// A rounded rectangle centred on the origin (x right, y up).
export function roundedRect(w: number, h: number, radii: Radii) {
  const [tl, tr, br, bl] = corners(radii).map((r) => Math.max(0, Math.min(r, w / 2, h / 2))) as [
    number,
    number,
    number,
    number,
  ]
  const x = -w / 2
  const y = -h / 2
  const s = new THREE.Shape()
  s.moveTo(x + bl, y)
  s.lineTo(x + w - br, y)
  if (br > 0) s.absarc(x + w - br, y + br, br, -Math.PI / 2, 0, false)
  s.lineTo(x + w, y + h - tr)
  if (tr > 0) s.absarc(x + w - tr, y + h - tr, tr, 0, Math.PI / 2, false)
  s.lineTo(x + tl, y + h)
  if (tl > 0) s.absarc(x + tl, y + h - tl, tl, Math.PI / 2, Math.PI, false)
  s.lineTo(x, y + bl)
  if (bl > 0) s.absarc(x + bl, y + bl, bl, Math.PI, Math.PI * 1.5, false)
  return s
}

// A flat rounded-rect face with UVs spanning 0..1 over its bounds (for screens and chrome).
export function roundedPlane(w: number, h: number, radii: Radii, segments = 16) {
  const geometry = new THREE.ShapeGeometry(roundedRect(w, h, radii), segments)
  const pos = geometry.attributes.position!
  const uv = geometry.attributes.uv!
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5)
  }
  uv.needsUpdate = true
  return geometry
}

// A rounded slab w×h×depth centred on the origin with softly rounded edges. Material groups:
// 0 = the two flat faces (front at +z, back at -z), 1 = the rounded sides. Face UVs span 0..1.
export function slab(w: number, h: number, radii: Radii, depth: number, bevel: number) {
  const b = Math.min(bevel, depth / 2 - 0.01, w / 4, h / 4)
  const inner = corners(radii).map((r) => Math.max(0.001, r - b)) as [
    number,
    number,
    number,
    number,
  ]
  const iw = w - 2 * b
  const ih = h - 2 * b
  const uvGenerator = {
    generateTopUV(_g: THREE.ExtrudeGeometry, v: number[], a: number, bb: number, c: number) {
      return [a, bb, c].map(
        (i) => new THREE.Vector2(v[i * 3]! / iw + 0.5, v[i * 3 + 1]! / ih + 0.5)
      )
    },
    generateSideWallUV() {
      return [0, 0, 0, 0].map(() => new THREE.Vector2(0, 0))
    },
  }
  const geometry = new THREE.ExtrudeGeometry(roundedRect(iw, ih, inner), {
    depth: Math.max(0.01, depth - 2 * b),
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 6,
    curveSegments: 18,
    UVGenerator: uvGenerator as unknown as THREE.ExtrudeGeometryOptions['UVGenerator'],
  })
  geometry.translate(0, 0, -(depth - 2 * b) / 2)
  // ExtrudeGeometry is non-indexed with flat normals; smooth the bevels, keep real creases.
  return toCreasedNormals(geometry, 0.7)
}
