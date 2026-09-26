// Camera path for media-grid — pure functions (no three.js, no GSAP), so the path can be sampled
// at any time (the motion blur reads it a fraction of a frame either side of t).
//
// The camera is a 2D view over the grid plane: centre (x, y) and the visible width w in world
// units (the height follows the frame aspect). The piece is a fixed sequence of segments:
//
//   open (overview) → dive → hold at a view → travel → hold … → pull-back → end (overview)
//
// - Every place the camera stops is a Shot: a world point (the anchor), where it sits on the
//   frame, and a width. The camera never stands still on a shot: it pushes in toward the anchor at
//   a slow constant rate (a drift that runs through the whole hold), so a hold is one living move,
//   not "land, nudge, settle".
// - Travels follow van Wijk & Nuij's smooth zoom-and-pan path ("Smooth and efficient zooming and
//   panning", 2003) between the two drifting shots: between two close-ups the camera eases out a
//   little while it crosses, and a move from the overview dives in on the way. The distance along
//   the path is eased with a cubic-bezier in-out whose ends have zero slope, so the camera leaves
//   with the drift's velocity and lands on the next drift's — no stop at either end.
// - The first dive and the pull-back (the reveal) are longer; the pull-back has a softer ease, so
//   the reveal is the calmest move of the piece. Each travel's time follows its length (around the
//   plan), so a long move isn't a whip.
// - The overview drifts out slowly through the loop point, and a slow orbit (constant speed, a
//   period that divides the duration) runs under everything; both are periodic, so with the
//   pull-back ending the last frame matches the first in position and velocity: the reel loops.

import type { Box, GridLayout } from './layout.ts'

export interface Cam {
  x: number
  y: number
  w: number
}

// A place the camera holds. The anchor (ax, ay) is the world point it pushes toward; it sits
// (kx, ky) × the design width from the frame centre (y down) — the box centre for a close-up, the
// sheet's centre for the overview. w: the visible width at the middle of the hold.
export interface Shot {
  ax: number
  ay: number
  kx: number
  ky: number
  w: number
}

// A close-up: the shot, and the cells whose own close-up landed on it (several cells share one
// view when the sheet leaves no room to move between them).
export interface View extends Shot {
  cells: number[]
  // The members' row / column when they all share one, else -1 (route rules).
  row: number
  col: number
}

export type Pace = 'Smooth' | 'Snappy'
export type Ending = 'Pull back' | 'Hero'

type Bezier = [number, number, number, number]

interface PaceSpec {
  // Nominal seconds; scaled to fit the duration.
  travel: number
  hold: number
  open: number
  end: number
  ease: Bezier // dives and travels
  reveal: Bezier // the pull-back: an earlier, softer take-off and a long landing
}

export const PACES: Record<Pace, PaceSpec> = {
  // Long, even glide; the landing tail is longer than the take-off. Views are held a little longer
  // than the moves between them.
  Smooth: {
    travel: 1.4,
    hold: 1.5,
    open: 0.45,
    end: 1.1,
    ease: [0.42, 0, 0.3, 1],
    reveal: [0.3, 0, 0.25, 1],
  },
  // Later, quicker take-off and a firm landing; more time on each view.
  Snappy: {
    travel: 1.1,
    hold: 1.7,
    open: 0.45,
    end: 1.1,
    ease: [0.66, 0, 0.18, 1],
    reveal: [0.45, 0, 0.22, 1],
  },
}

// Travel lengths relative to the pace's: the first dive and the reveal get room to breathe.
const DIVE = 1.15
const REVEAL = 1.35
const FINALE = 1.2 // the last travel, into the hero
// The overview at the end is held at least this long (s; 16% of a short piece).
const END_MIN = 1.0
// Drift: log-zoom per second while holding a view (≈1.5 px/frame at a story frame's corners) and
// at the overview, and the most one hold pushes in (a long hold drifts slower).
const DRIFT = 0.045
const OVERVIEW_DRIFT = 0.035
const DRIFT_MAX = 0.07
// The hero's last hold pushes in by about this much (log-zoom): at least 0.035/s, at most 0.16
// in all (a long hero hold drifts slower).
const HERO_PUSH = 0.12
// Framing budgets for the drift: a close-up arrives this much wider (and leaves as much closer).
const DRIFT_MARGIN = DRIFT_MAX / 2
// Van Wijk's rho: how much a travel zooms out to cross (√2 is the paper's optimum; lower is
// flatter, closer to a straight pan).
const RHO = 1.25
// The orbit under everything: radius as a share of the view width, and zoom breathing.
const ORBIT = 0.0075
const BREATH = 0.004

// ── Easing ─────────────────────────────────────────────────────────────────────────────────

// CSS-style cubic-bezier(x1, y1, x2, y2) timing function.
export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx
  return (x: number) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let t = x
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x
      if (Math.abs(err) < 1e-7) return sampleY(t)
      const d = slopeX(t)
      if (Math.abs(d) < 1e-6) break
      t -= err / d
    }
    // Newton stalled (flat start/end): bisect.
    let lo = 0
    let hi = 1
    t = x
    for (let i = 0; i < 40; i++) {
      const v = sampleX(t)
      if (Math.abs(v - x) < 1e-7) break
      if (v < x) lo = t
      else hi = t
      t = (lo + hi) / 2
    }
    return sampleY(t)
  }
}

// ── Zoom-and-pan path ──────────────────────────────────────────────────────────────────────

// `aspect` = view height / width: sizes are compared as sqrt(w·h), so a move across a tall story
// frame zooms out as much as the same move across a square one.
export function zoomPath(a: Cam, b: Cam, aspect: number, rho = RHO) {
  const k = Math.sqrt(aspect)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const u1 = Math.hypot(dx, dy)
  const w0 = a.w * k
  const w1 = b.w * k
  const at = (x: number, y: number, size: number): Cam => ({ x, y, w: size / k })

  if (u1 < 1e-6 * Math.max(w0, w1)) {
    const z = Math.log(w1 / w0)
    const S = Math.abs(z) / rho
    return {
      S,
      at: (s: number) => {
        const f = S > 0 ? s / S : 1
        return at(a.x + dx * f, a.y + dy * f, w0 * Math.exp(z * f))
      },
    }
  }
  const rho2 = rho * rho
  const b0 = (w1 * w1 - w0 * w0 + rho2 * rho2 * u1 * u1) / (2 * w0 * rho2 * u1)
  const b1 = (w1 * w1 - w0 * w0 - rho2 * rho2 * u1 * u1) / (2 * w1 * rho2 * u1)
  const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0)
  const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1)
  const S = (r1 - r0) / rho
  return {
    S,
    at: (s: number) => {
      const u = (w0 / rho2) * (Math.cosh(r0) * Math.tanh(rho * s + r0) - Math.sinh(r0))
      const size = (w0 * Math.cosh(r0)) / Math.cosh(rho * s + r0)
      return at(a.x + (dx * u) / u1, a.y + (dy * u) / u1, size)
    },
  }
}

// The camera for a shot at `f` × its width (f < 1 is closer), the anchor staying put on the frame.
export function shotCam(s: Shot, f = 1): Cam {
  const w = s.w * f
  return { x: s.ax - s.kx * w, y: s.ay + s.ky * w, w }
}

// ── Timing ─────────────────────────────────────────────────────────────────────────────────

export interface Timing {
  stops: number
  open: number
  // Pull back: dive, travels…, reveal (stops + 1). Hero: dive, travels…, finale (stops).
  travels: number[]
  // One per stop except the hero's (its hold is `end`).
  holds: number[]
  end: number // the last hold (pull-back: on the overview; hero: on the hero view)
}

function travelWeights(n: number, hero: boolean) {
  if (hero) {
    if (n === 1) return [Math.max(DIVE, FINALE)]
    return [DIVE, ...Array<number>(n - 2).fill(1), FINALE]
  }
  return [DIVE, ...Array<number>(n - 1).fill(1), REVEAL]
}

function timingFor(T: number, n: number, pace: PaceSpec, ending: Ending) {
  const hero = ending === 'Hero'
  const weights = travelWeights(n, hero)
  const holds = hero ? n - 1 : n
  const travelNominal = weights.reduce((a, b) => a + b, 0) * pace.travel
  const endNominal = hero ? pace.hold + pace.end : pace.end
  const rest = pace.open + holds * pace.hold + endNominal
  // Travels flex less than holds: a move keeps its feel, the views give or take the time.
  const x = T / (travelNominal + rest)
  let ft = Math.min(1.25, Math.max(0.8, x))
  let kh = (T - ft * travelNominal) / rest
  // Holds never shrink below 55% of nominal: shorten the travels instead (down to 0.8 s).
  if (kh < 0.55) {
    kh = 0.55
    ft = (T - rest * kh) / travelNominal
    if (ft * pace.travel < 0.8) return null
  }
  // The overview at the end is held long enough to read (taken from the other holds).
  let end = endNominal * kh
  let k = kh
  const endMin = Math.min(END_MIN, 0.16 * T)
  if (!hero && end < endMin) {
    const others = (pace.open + holds * pace.hold) * kh
    const spare = others - (endMin - end)
    if (spare < others * 0.55) return null
    k = (kh * spare) / others
    end = endMin
  }
  const timing: Timing = {
    stops: n,
    open: pace.open * k,
    travels: weights.map((w) => w * pace.travel * ft),
    holds: Array<number>(holds).fill(pace.hold * k),
    end,
  }
  return { timing, ft, kh: k }
}

// Stops: a number, or Auto — as many as keep the travels and holds near their nominal length.
// Dense sheets (many distinct views) lean toward one more stop when the time allows.
export function planTiming(
  T: number,
  requested: number | 'Auto',
  pace: Pace,
  ending: Ending,
  maxStops: number,
  dense = false
): Timing {
  const spec = PACES[pace]
  if (requested !== 'Auto') {
    for (let n = Math.max(1, Math.min(requested, maxStops)); n >= 1; n--) {
      const t = timingFor(T, n, spec, ending)
      if (t) return t.timing
    }
  } else {
    let best: { t: Timing; score: number } | null = null
    for (let n = 1; n <= maxStops; n++) {
      const t = timingFor(T, n, spec, ending)
      if (!t) break
      // Stretching holds is worse than compressing them on a dense sheet (more to see).
      const stretch = dense && t.kh > 1 ? 1.6 : 1
      const score = Math.abs(Math.log(t.ft)) + Math.abs(Math.log(t.kh)) * stretch
      if (!best || score < best.score) best = { t: t.timing, score }
    }
    if (best) return best.t
  }
  // Too short for even one stop at the minimum pace: one stop, everything compressed.
  const hero = ending === 'Hero'
  return hero
    ? { stops: 1, open: T * 0.1, travels: [T * 0.45], holds: [], end: T * 0.45 }
    : { stops: 1, open: T * 0.08, travels: [T * 0.27, T * 0.33], holds: [T * 0.14], end: T * 0.18 }
}

// ── Choosing the views ─────────────────────────────────────────────────────────────────────

// Picks `count` stops among the distinct views, deterministic for a given random(). Consecutive
// views sit a comfortable distance apart (about a view — never a nudge, never a trip across the
// whole sheet), the direction keeps changing, views are revisited only when there are more stops
// than views, and with the hero ending the view holding the hero is kept for the end (the last
// stop is the hero itself, returned as -1). On small sheets the route avoids running along an
// edge row / column (the close-ups there all lean on the same edge); it never steps back and
// forth along one row or column.
export function chooseStops(
  views: View[],
  overview: Shot,
  count: number,
  options: {
    hero: Shot | null
    heroView: number // the view holding the hero's cell (-1: none)
    aspect: number // view height / width
    rows: number
    cols: number
    small: boolean // few media: edge rows / columns count
  },
  random: () => number
): number[] {
  const { hero, heroView, aspect, rows, cols, small } = options
  const n = views.length
  // Distances are read against the view's size, sqrt(w·h) (as in zoomPath).
  const unit = Math.sqrt(aspect)
  const order: number[] = []
  const visits = new Array<number>(n).fill(0)
  let from: Cam = shotCam(overview)
  let heading: [number, number] | null = null
  const edgeRow = (r: number) => rows >= 2 && (r === 0 || r === rows - 1)
  const edgeCol = (c: number) => cols >= 3 && (c === 0 || c === cols - 1)
  const pick = (weights: number[]) => {
    const total = weights.reduce((a, b) => a + b, 0)
    if (!(total > 0)) {
      // Nothing fits the rules: any view but the current (and the hero's, when it can wait).
      const last = order[order.length - 1]
      let free = views.map((_, i) => i).filter((i) => i !== last && i !== heroView)
      if (!free.length) free = views.map((_, i) => i).filter((i) => i !== last)
      if (!free.length) free = [0]
      return free[Math.floor(random() * free.length)]!
    }
    let r = random() * total
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i]!
      if (r < 0) return i
    }
    return weights.length - 1
  }
  for (let step = 0; step < count; step++) {
    const last = step === count - 1
    if (hero && last) {
      order.push(-1)
      break
    }
    const prev = order.length ? views[order[order.length - 1]!]! : null
    const prev2 = order.length > 1 ? views[order[order.length - 2]!]! : null
    const weights = views.map((view, i) => {
      if (order.length && order[order.length - 1] === i) return 0
      if (hero && i === heroView && n > 1) return 0 // the hero is saved for the end
      const v = shotCam(view)
      // Scale: the smaller view of the two (distances read against what the camera shows).
      const size = Math.min(v.w, from.w) * unit
      const d = Math.hypot(v.x - from.x, v.y - from.y) / size
      // Log-normal around most of a view; the first dive likes an off-centre cell. A trip across
      // the sheet is a whip, not a glide.
      const ideal = step === 0 ? 0.4 : 0.6
      const sigma = step === 0 ? 0.4 : 0.5
      let w = Math.exp(-((Math.log(Math.max(d, 0.02) / ideal) / sigma) ** 2))
      if (d < 0.2 && n > 2) w *= 0.05
      if (d > 1.1) w *= 0.2
      let reverse = false
      if (heading && d > 1e-6) {
        const cos = ((v.x - from.x) * heading[0] + (v.y - from.y) * heading[1]) / (d * size)
        reverse = cos < -0.5
        w *= cos < -0.8 ? 0.25 : cos > 0.9 ? 0.7 : 1 // straight back reads as a mistake
      }
      if (prev) {
        const sameRow = view.row >= 0 && view.row === prev.row
        const sameCol = view.col >= 0 && view.col === prev.col
        // Doubling back along the row / column just travelled reads as dithering.
        if (reverse && (sameRow || sameCol)) w *= 0.05
        // Two in a row along an edge: every close-up leans on the same edge of the sheet.
        if (small && ((sameRow && edgeRow(view.row)) || (sameCol && edgeCol(view.col)))) w *= 0.15
        // Never a third stop in the same row.
        if (sameRow && prev2 && prev2.row === view.row) return 0
      }
      w /= 1 + 4 * visits[i]! // fresh views first
      // The step before the hero: not right next to it, not across the sheet.
      if (hero && step === count - 2 && n > 1) {
        const h = shotCam(hero)
        const dh = Math.hypot(v.x - h.x, v.y - h.y) / (Math.min(v.w, h.w) * unit)
        w *= Math.exp(-((Math.log(Math.max(dh, 0.02) / 0.8) / 0.7) ** 2))
      }
      return w
    })
    const i = pick(weights)
    const v = shotCam(views[i]!)
    const d = Math.hypot(v.x - from.x, v.y - from.y)
    heading = d > 1e-6 ? [(v.x - from.x) / d, (v.y - from.y) / d] : heading
    order.push(i)
    visits[i]!++
    from = v
  }
  return order
}

// ── The whole path ─────────────────────────────────────────────────────────────────────────

// Durations scaled by `factors`, each kept within 0.8–1.3× its planned length, summing to the
// planned total.
function distribute(planned: number[], factors: number[]) {
  const total = planned.reduce((a, b) => a + b, 0)
  let out = planned.map((d, i) => d * factors[i]!)
  for (let pass = 0; pass < 4; pass++) {
    const sum = out.reduce((a, b) => a + b, 0)
    out = out.map((d, i) =>
      Math.min(1.3 * planned[i]!, Math.max(0.8 * planned[i]!, (d * total) / sum))
    )
  }
  const sum = out.reduce((a, b) => a + b, 0)
  return out.map((d) => (d * total) / sum)
}

type Drift = (t: number) => Cam

type Segment =
  | { t0: number; t1: number; kind: 'hold'; at: Drift }
  | {
      t0: number
      t1: number
      kind: 'travel'
      from: Drift
      to: Drift
      ease: (u: number) => number
    }

export interface CameraPath {
  at(t: number): Cam
  // Each stop's hold (seconds), in order.
  holds: { t0: number; t1: number }[]
  segments: { t0: number; t1: number; kind: 'hold' | 'travel' }[]
}

export function buildPath(options: {
  duration: number
  overview: Shot
  stops: Shot[] // in visiting order
  timing: Timing
  pace: Pace
  ending: Ending
  aspect: number // view height / width
  phase: [number, number]
}): CameraPath {
  const { duration: T, overview, stops, timing, aspect } = options
  const hero = options.ending === 'Hero'
  const spec = PACES[options.pace]
  const ease = cubicBezier(...spec.ease)
  const reveal = cubicBezier(...spec.reveal)
  const segments: Segment[] = []
  const holds: { t0: number; t1: number }[] = []

  // The overview drifts out at a constant rate through t = 0 and t = T (a sine over the whole
  // piece, so it is smooth everywhere and periodic): the reel's last frame is its first. Out, not
  // in: the reveal lands straight into it (a push-in there would make the pull-back bounce), and
  // the dive then takes off against it — a touch of anticipation.
  const longest = Math.max(timing.open, hero ? 0 : timing.end, 0.5)
  const ro = Math.min(OVERVIEW_DRIFT, DRIFT_MAX / longest)
  const overviewDrift: Drift = (t) =>
    shotCam(overview, Math.exp((ro * T * Math.sin((2 * Math.PI * t) / T)) / (2 * Math.PI)))
  // A stop drifts in toward its anchor through its hold, centred on the framed view.
  const stopDrift = (shot: Shot, centre: number, rate: number): Drift => {
    return (t) => shotCam(shot, Math.exp(-rate * (t - centre)))
  }

  let t = 0
  const hold = (at: Drift, d: number) => {
    segments.push({ t0: t, t1: t + d, kind: 'hold', at })
    t += d
  }
  const travel = (from: Drift, to: Drift, d: number, e = ease) => {
    segments.push({ t0: t, t1: t + d, kind: 'travel', from, to, ease: e })
    t += d
  }

  // Travel time follows the length of each move (its zoom-and-pan distance, square-rooted) around
  // the planned lengths, so a long move isn't a whip and a short one doesn't crawl; the total and
  // the holds stay as planned.
  const places = [overview, ...stops, ...(hero ? [] : [overview])].map((s) => shotCam(s))
  const lengths = timing.travels.map((_, i) => zoomPath(places[i]!, places[i + 1]!, aspect).S)
  const meanLength = lengths.reduce((a, b) => a + b, 0) / Math.max(1, lengths.length)
  const travels =
    meanLength > 1e-3
      ? distribute(
          timing.travels,
          lengths.map((S) => (Math.max(S, 0.35 * meanLength) / meanLength) ** 0.8)
        )
      : timing.travels

  hold(overviewDrift, timing.open)
  let previous = overviewDrift
  stops.forEach((stop, i) => {
    const lastHero = hero && i === stops.length - 1
    const d = lastHero ? Math.max(0, T - t - travels[i]!) : timing.holds[i]!
    const start = t + travels[i]!
    // The hero's long last hold is anchored on its end: it arrives wider and keeps pushing in,
    // reaching the framed view (the cap) at T.
    const centre = lastHero ? start + d : start + d / 2
    const long = Math.max(d, 1e-3)
    const rate = lastHero
      ? Math.min(Math.min(DRIFT, Math.max(0.035, HERO_PUSH / long)), 0.16 / long)
      : Math.min(DRIFT, DRIFT_MAX / long)
    const drift = stopDrift(stop, centre, rate)
    travel(previous, drift, travels[i]!)
    holds.push({ t0: start, t1: start + d })
    hold(drift, d)
    previous = drift
  })
  if (!hero) {
    travel(previous, overviewDrift, travels[stops.length]!, reveal)
    hold(overviewDrift, Math.max(0, T - t))
  }

  // Orbit period: a whole number of turns over the piece, about 9 s each.
  const period = T / Math.max(1, Math.round(T / 9))
  const [p0, p1] = options.phase

  const base = (time: number): Cam => {
    let seg = segments[segments.length - 1]!
    for (const s of segments) {
      if (time < s.t1) {
        seg = s
        break
      }
    }
    if (seg.kind === 'hold') return seg.at(time)
    const u = seg.t1 > seg.t0 ? Math.min(1, Math.max(0, (time - seg.t0) / (seg.t1 - seg.t0))) : 1
    const path = zoomPath(seg.from(time), seg.to(time), aspect)
    return path.at(path.S * seg.ease(u))
  }

  return {
    holds,
    segments: segments.map(({ t0, t1, kind }) => ({ t0, t1, kind })),
    at(time) {
      const c = base(time)
      const a = (2 * Math.PI * time) / period
      const w = c.w * (1 + BREATH * Math.sin(2 * a + p1))
      return {
        x: c.x + ORBIT * c.w * Math.cos(a + p0),
        y: c.y + ORBIT * 0.8 * c.w * Math.sin(a + p0),
        w,
      }
    },
  }
}

// ── Framing ────────────────────────────────────────────────────────────────────────────────

// The zoom control's default: at it the focused cell's limiting side fills about 85% of the box.
export const ZOOM_DEFAULT = 0.85
// The focused cell's share of the box at the closest (zoom 1, and every hero).
const CLOSE_MAX = 0.92
// Design px a close-up keeps between the focused cell and the frame edge when the cell already
// spans the box at the overview (a single column of wide cells).
const FRAME_MARGIN = 28

// The overview and the close-ups, for a grid laid out to fit `box` (design px, frame coordinates;
// the design frame is dw × dh). World units are design px at the overview.
//
// A close-up puts its cell at the box centre, magnified so the cell fills about 85% of the box
// (the zoom control), then slides it toward the grid so the sheet's edge never comes into the box
// — an edge cell sits on the margin with its neighbours beside it — but never so far that the
// cell itself is cut. When that leaves too little room to move between neighbours on an axis, the
// magnification rises (up to the cap) until there is; if it still isn't enough the views stay
// clamped and collapse together (merged into one), and the route travels along the axis that
// has room. The focused cell always keeps a margin: at most 92% of the box, and a cell that
// already spans the box (a single column) is never magnified past the frame.
export function framing(grid: GridLayout, box: Box, dw: number, dh: number, zoom: number) {
  // The box centre's offset from the frame centre (design px, y down), as a share of dw.
  const kx = (box.x + box.w / 2 - dw / 2) / dw
  const ky = (box.y + box.h / 2 - dh / 2) / dw
  // The overview centres the sheet on the frame when it fits clear of the caption (the type then
  // reads as a footnote to a centred composition), else as close to centre as the box allows. It
  // pushes toward the sheet's centre.
  const top = Math.min(box.y + box.h - grid.height, Math.max(box.y, (dh - grid.height) / 2))
  const overview: Shot = { ax: 0, ay: 0, kx, ky: (top + grid.height / 2 - dh / 2) / dw, w: dw }

  const { cellW, cellH } = grid
  const fill = Math.min(box.w / cellW, box.h / cellH)
  const frameFit = Math.min((dw - 2 * FRAME_MARGIN) / cellW, (dh - 2 * FRAME_MARGIN) / cellH)
  const lo = Math.max(1, Math.min(1.1, frameFit / (1 + DRIFT_MARGIN)))
  const cap = Math.max(lo, fill * CLOSE_MAX)
  // Zoom: 0 → 1.15× the overview, 1 → the cell fills 92% of the box (linear in that share).
  const z = Math.min(1, Math.max(0, zoom))
  const s0 = 1.15 / fill
  const mag0 = Math.min(cap, Math.max(1, fill * (s0 + (CLOSE_MAX - s0) * z)))

  // Room to move: how far the box centre can travel from the sheet's centre before the sheet's
  // edge comes into the box (at the drift's widest), per axis.
  const reachAt = (m: number, span: number, extent: number) =>
    Math.max(0, span / 2 - (extent * (1 + DRIFT_MARGIN)) / (2 * m))
  const spread = (values: number[]) => Math.max(...values) - Math.min(...values)
  const xs = grid.cells.map((c) => c.x)
  const ys = grid.cells.map((c) => c.y)
  const cols = Math.max(...grid.rows)
  const R = grid.rows.length
  // Neighbouring views at least half a pitch apart (and the outer ones most of the way out).
  const needX = cols > 1 ? Math.min(0.4 * spread(xs), 0.5 * grid.pitchX) : 0
  const needY = R > 1 ? Math.min(0.4 * spread(ys), 0.5 * grid.pitchY) : 0
  const magFor = (need: number, span: number, extent: number) =>
    need > 0
      ? span - 2 * need > 0
        ? (extent * (1 + DRIFT_MARGIN)) / (span - 2 * need)
        : Infinity
      : 0
  // Rise at most as far as the zoom control allows (all the way at its default and above).
  const ceiling = mag0 + (cap - mag0) * Math.min(1, z / ZOOM_DEFAULT)
  const mag = Math.min(
    ceiling,
    Math.max(mag0, magFor(needX, grid.width, box.w), magFor(needY, grid.height, box.h))
  )
  // Clamp ranges: the reach, plus at most `extra` where the sheet is short of room (one gap).
  const clampRange = (need: number, span: number, extent: number, extra: number) => {
    const r = reachAt(mag, span, extent)
    return r < need ? r + Math.min(extra, need - r) : r
  }
  const bw = box.w / mag
  const bh = box.h / mag
  const axis = (c: number, r: number, half: number, size: number) => {
    const v = Math.min(r, Math.max(-r, c))
    const slack = half - size / 2
    return slack >= 0 ? Math.min(c + slack, Math.max(c - slack, v)) : c
  }
  const tolerance = Math.max(grid.gap, 0.06 * Math.min(bw, bh))
  const place = (extraX: number, extraY: number) => {
    const rx = clampRange(needX, grid.width, box.w, extraX)
    const ry = clampRange(needY, grid.height, box.h, extraY)
    const anchors = grid.cells.map((cell) => ({
      x: axis(cell.x, rx, bw / 2, cellW),
      y: axis(cell.y, ry, bh / 2, cellH),
    }))
    // Merge views that collapse onto (nearly) the same spot.
    const groups: number[][] = []
    const cellView: number[] = []
    anchors.forEach((a, i) => {
      const g = groups.findIndex((members) => {
        const b = anchors[members[0]!]!
        return Math.hypot(a.x - b.x, a.y - b.y) < tolerance
      })
      if (g >= 0) {
        groups[g]!.push(i)
        cellView[i] = g
      } else {
        cellView[i] = groups.length
        groups.push([i])
      }
    })
    return { anchors, groups, cellView }
  }
  let placed = place(grid.gap, grid.gap)
  // Everything on one spot (two wide cells stacked in a story, say — the cells already span the
  // frame, so nothing can come closer): let the views part by a little more than a gap, so the
  // camera still glides from one cell toward the other instead of breathing on the spot.
  if (placed.groups.length === 1 && grid.cells.length > 1) {
    placed = place(Math.max(grid.gap, 0.1 * grid.pitchX), Math.max(grid.gap, 0.1 * grid.pitchY))
  }
  const { anchors, groups, cellView } = placed
  const views: View[] = groups.map((members) => {
    const mean = (f: (a: { x: number; y: number }) => number) =>
      members.reduce((s, i) => s + f(anchors[i]!), 0) / members.length
    const rows = new Set(members.map((i) => grid.cells[i]!.row))
    const colsOf = new Set(members.map((i) => grid.cells[i]!.col))
    const first = grid.cells[members[0]!]!
    return {
      ax: mean((a) => a.x),
      ay: mean((a) => a.y),
      kx,
      ky,
      w: dw / mag,
      cells: members.map((i) => grid.cells[i]!.index),
      row: rows.size === 1 ? first.row : -1,
      // Columns only mean something when the rows line up (full rows).
      col: colsOf.size === 1 && new Set(grid.rows).size === 1 ? first.col : -1,
    }
  })

  // The hero (Ending: Hero, the first medium): centred in the box and closer — the cap.
  const heroMag = Math.max(mag, cap)
  const first = grid.cells[0]!
  const hero: Shot = { ax: first.x, ay: first.y, kx, ky, w: dw / heroMag }
  return { overview, views, cellView, hero, mag, heroMag }
}

// mulberry32.
function seeded(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Timing, the visited views and the path. `random` is ctx.random (setup only). The choices run on
// their own generator seeded from it and the grid's shape, so two grids made with the same seed
// (Pullup's default is 1) still take different routes. `order` holds view indices (-1: the hero).
export function planCamera(options: {
  duration: number
  grid: GridLayout
  overview: Shot
  views: View[]
  cellView: number[]
  hero: Shot // the last stop with the Hero ending
  stops: number | 'Auto'
  pace: Pace
  ending: Ending
  aspect: number // view height / width
  random: () => number
}): { path: CameraPath; order: number[]; timing: Timing } {
  const { grid, views } = options
  const V = views.length
  let seed = Math.floor(options.random() * 4294967296)
  for (const r of grid.rows) seed = Math.imul(seed ^ (r + 0x9e3779b9), 0x85ebca6b) >>> 0
  seed = Math.imul(seed ^ grid.cells.length, 0xc2b2ae35) >>> 0
  const random = seeded(seed)
  const hero = options.ending === 'Hero'
  // Views to visit, plus the hero; revisits only on bigger sheets.
  const places = V + (hero ? 1 : 0)
  const maxStops = Math.min(12, Math.max(1, places < 3 ? places : Math.round(places * 1.5)))
  const timing = planTiming(
    options.duration,
    options.stops,
    options.pace,
    options.ending,
    maxStops,
    V >= 9
  )
  const order = chooseStops(
    views,
    options.overview,
    timing.stops,
    {
      hero: hero ? options.hero : null,
      heroView: hero ? options.cellView[0]! : -1,
      aspect: options.aspect,
      rows: grid.rows.length,
      cols: Math.max(...grid.rows),
      small: grid.cells.length <= 6,
    },
    random
  )
  const path = buildPath({
    duration: options.duration,
    overview: options.overview,
    stops: order.map((i) => (i < 0 ? options.hero : views[i]!)),
    timing,
    pace: options.pace,
    ending: options.ending,
    aspect: options.aspect,
    phase: [random() * Math.PI * 2, random() * Math.PI * 2],
  })
  return { path, order, timing }
}
