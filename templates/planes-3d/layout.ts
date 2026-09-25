// Scene layout and camera path for planes-3d. Pure functions of their inputs (and ctx.random).
//
// World: the camera travels down -z; a 16:10 plane is ~1 unit wide.
// - Stack: planes alternate above/below the path. The camera lands on each one (framed on the same
//   grid box as the last plane), then cranes past its edge toward the next.
// - Zigzag: planes 0…n-2 alternate either side of the axis and the camera glides past them.
// In every arrangement the last plane is face-on and the camera settles in front of it.

import * as THREE from 'three'

export type Arrangement = 'Stack' | 'Zigzag'

export interface PlaneSpec {
  w: number
  h: number
  x: number
  y: number
  z: number
  rx: number
  ry: number
  rz: number
  // Float phase (radians) for the gentle idle bob.
  phase: number
}

// Every plane gets the same world area, so portrait and landscape media feel equally weighted.
const AREA = 0.62
// Zigzag: clear space between the travel axis and the nearest edge of a plane.
const CLEAR = 0.26
// Zigzag: how much planes turn to face the travel axis (radians).
const TURN = 0.24

// Plane aspect is the media's own, clamped so extreme ratios don't become slivers
// (the texture is cover-fitted into the clamped plane).
export function planeSize(mediaAspect: number) {
  const ar = Math.min(2, Math.max(0.5, mediaAspect))
  return { w: Math.sqrt(AREA * ar), h: Math.sqrt(AREA / ar), ar }
}

// A plane of w×h pushed out from the axis in direction `a` until its nearest edge is `clear` away,
// turned slightly to face the axis.
function place(w: number, h: number, a: number, clear: number) {
  const c = Math.cos(a)
  const s = Math.sin(a)
  const reach = clear + Math.abs(c) * (w / 2) + Math.abs(s) * (h / 2)
  return { x: c * reach, y: s * reach, rx: s * TURN, ry: -c * TURN }
}

// Stack: every plane (the last one too) alternates above/below the previous one. The camera lands
// on each plane (framed on the grid), then cranes past its edge toward the next: the vertical move
// leads the dolly so it is done before the camera reaches the plane's depth, and each pair is
// spaced so that pass keeps PASS_CLEAR of air. Plane 1 sits above plane 0, so the opening frame
// shows it peeking out above (away from the caption).
const STACK_CLEAR = 0.12 // minimum gap between neighbouring planes as seen head-on
const PASS_CLEAR = 0.2 // camera ↔ plane edge when passing (covers the drift)
const LEAD = 0.75 // the vertical move finishes at 75 % of each segment

export interface StackFraming {
  // Camera distance at which the plane is framed on the grid.
  distance: number
  // Camera y relative to the plane centre when framed (the grid box need not be centred).
  offset: number
}

export function stackLayout(
  sizes: { w: number; h: number }[],
  frames: StackFraming[],
  random: () => number
) {
  const n = sizes.length
  const jitter = (a: number) => (random() - 0.5) * 2 * a
  // Just deeper than the framing distance: when the camera lands on a plane, the one it left is
  // already behind it.
  const gap = Math.max(...frames.map((f) => f.distance)) + 0.2
  const z = sizes.map((_, i) => -i * gap)
  const curveZ = new THREE.CatmullRomCurve3(
    z.map((zi, i) => new THREE.Vector3(0, 0, zi + frames[i]!.distance)),
    false,
    'catmullrom',
    0.5
  )
  const zAt = (s: number) => curveZ.getPoint(s / (n - 1)).z

  const specs: PlaneSpec[] = []
  let y = 0
  sizes.forEach(({ w, h }, i) => {
    if (i > 0) {
      const k = i - 1
      const dir = i % 2 === 1 ? 1 : -1
      // Where along segment k the camera reaches plane k's depth, and how far it has craned.
      let lo = 0
      let hi = 1
      for (let it = 0; it < 30; it++) {
        const mid = (lo + hi) / 2
        if (zAt(k + mid) > z[k]!) lo = mid
        else hi = mid
      }
      const moved = smoothstep(0, LEAD, hi)
      const drift = frames[k]!.offset * (1 - moved) + frames[i]!.offset * moved
      const pass = (sizes[k]!.h / 2 + PASS_CLEAR - dir * drift) / Math.max(moved, 0.05)
      y += dir * Math.max((sizes[k]!.h + h) / 2 + STACK_CLEAR, pass)
    }
    const phase = random() * Math.PI * 2
    const tilt = { x: jitter(0.1), rx: jitter(0.05), ry: jitter(0.07), rz: jitter(0.015) }
    // The last plane is where the camera settles: square to the lens.
    specs.push(
      i === n - 1
        ? { w, h, x: 0, y, z: z[i]!, rx: 0, ry: 0, rz: 0, phase }
        : { w, h, y, z: z[i]!, ...tilt, phase }
    )
  })

  const stations = specs.map((spec, i) => ({ x: spec.x, y: spec.y + frames[i]!.offset }))
  // Camera position at station parameter s in [0, n-1] (integers = a plane framed).
  const point = (s: number, out: THREE.Vector3) => {
    const k = Math.min(n - 2, Math.max(0, Math.floor(s)))
    const e = smoothstep(0, LEAD, s - k)
    const a = stations[k]!
    const b = stations[k + 1]!
    return out.set(lerp(a.x, b.x, e), lerp(a.y, b.y, e), zAt(s))
  }
  return { specs, gap, point }
}

// Zigzag: positions for every plane but the last, alternating upper-right / lower-left. `tall` is
// the frame's height/width (taller frames get a steeper, more vertical rhythm).
export function zigzag(
  sizes: { w: number; h: number }[],
  gap: number,
  tall: number,
  random: () => number
): PlaneSpec[] {
  const jitter = (a: number) => (random() - 0.5) * 2 * a
  // Zigzag direction: ~35° in 4:5, ~58° in 9:16.
  const slope = 0.61 + (Math.min(1.78, Math.max(1.25, tall)) - 1.25) * 0.75
  return sizes.map(({ w, h }, i) => {
    const phase = random() * Math.PI * 2
    const z = -i * gap
    const a = (i % 2 === 0 ? slope : slope + Math.PI) + jitter(0.1)
    return { w, h, ...place(w, h, a, CLEAR), z, rz: jitter(0.015), phase }
  })
}

// Camera progress along the path for u = t / duration in [0,1]: eases out of rest, cruises, then
// decelerates on a long tail (the "settle"). C1-continuous, so the motion never jerks.
const A = 0.1 // acceleration ends
const C = 0.6 // deceleration starts
const P = 3.5 // tail exponent
const V = 1 / (A / 2 + (C - A) + (1 - C) / P)
const SC = V * (A / 2 + C - A)

export function travel(u: number) {
  if (u <= 0) return 0
  if (u >= 1) return 1
  if (u < A) return (V * u * u) / (2 * A)
  if (u < C) return V * (A / 2 + u - A)
  const x = (u - C) / (1 - C)
  return SC + (1 - SC) * (1 - Math.pow(1 - x, P))
}

// First u at which travel(u) reaches `s` (bisection; setup only).
export function travelTime(s: number) {
  let lo = 0
  let hi = 1
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2
    if (travel(mid) < s) lo = mid
    else hi = mid
  }
  return hi
}

// Stack: slows the camera around every integer station (a plane framed on the grid) and speeds it
// up in between. Monotonic for depth < 1; stations stay where they are.
export function dwell(s: number, depth: number) {
  return s - (depth * Math.sin(2 * Math.PI * s)) / (2 * Math.PI)
}

export const lerp = (a: number, b: number, k: number) => a + (b - a) * k

export const smoothstep = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return k * k * (3 - 2 * k)
}
