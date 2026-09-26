// Grid layout for media-grid — pure functions (no three.js), in design px.
//
// The grid is rows × columns cells of one shape (Square / Desktop 16:10 / Mobile 9:19.5), every row
// full, laid out to fit a box on the frame exactly at the overview: one world unit = one design px
// when the camera shows the whole grid. The cell count comes from the grid, not from the media:
//
// - Columns and Rows set: that grid (5 media in 2 × 2 show the first four).
// - One of them Auto: as many as the media need — 6 columns and 1 image is one row of six.
// - Both Auto: the column count whose cells cover most of the box (a repeated medium's cell counts
//   half: a repeat fills space but shows nothing new), rows as the media need.
// An Auto grid has at least AUTO_MIN_CELLS cells (one or two cells aren't a grid).
//
// Fewer media than cells: the media repeat to fill every cell (assignMedia).

export type CellShape = 'Square' | 'Desktop' | 'Mobile'

// Width / height.
export const CELL_ASPECT: Record<CellShape, number> = {
  Square: 1,
  Desktop: 16 / 10,
  Mobile: 9 / 19.5,
}

export const MAX_COLUMNS = 6
export const MAX_ROWS = 8
const AUTO_MIN_CELLS = 3

export interface Box {
  // Design px, frame coordinates (y down).
  x: number
  y: number
  w: number
  h: number
}

export interface Cell {
  index: number // reading order
  media: number // the medium it shows
  row: number
  col: number
  // Centre in world units (y up; the grid is centred on the origin).
  x: number
  y: number
}

export interface GridLayout {
  cells: Cell[]
  rows: number
  cols: number
  cellW: number
  cellH: number
  gap: number
  width: number // grid bounds
  height: number
  // Horizontal / vertical distance between neighbouring cell centres.
  pitchX: number
  pitchY: number
}

// Cell size that fits rows × columns into the box.
function fit(rows: number, cols: number, aspect: number, gap: number, box: Box) {
  const byW = (box.w - (cols - 1) * gap) / cols
  const byH = ((box.h - (rows - 1) * gap) / rows) * aspect
  const cellW = Math.max(1, Math.min(byW, byH))
  return { cellW, cellH: cellW / aspect }
}

// Rows × columns for n media (see the top of the file).
export function gridSize(
  n: number,
  shape: CellShape,
  columns: number | 'Auto',
  rows: number | 'Auto',
  gap: number,
  box: Box
): { rows: number; cols: number } {
  const need = Math.max(n, AUTO_MIN_CELLS)
  if (columns !== 'Auto' && rows !== 'Auto') return { rows, cols: columns }
  if (columns !== 'Auto') return { rows: Math.ceil(need / columns), cols: columns }
  if (rows !== 'Auto') return { rows, cols: Math.ceil(need / rows) }
  const aspect = CELL_ASPECT[shape]
  let best: { rows: number; cols: number; score: number } | null = null
  for (let c = 1; c <= Math.min(MAX_COLUMNS, need); c++) {
    const r = Math.ceil(need / c)
    const { cellW, cellH } = fit(r, c, aspect, gap, box)
    const cells = r * c
    const unique = Math.min(n, cells)
    let score = ((unique + 0.5 * (cells - unique)) * cellW * cellH) / (box.w * box.h)
    if (c === 1 && n >= 4) score *= 0.8 // a single column only when it clearly wins
    if (!best || score > best.score + 1e-9) best = { rows: r, cols: c, score }
  }
  return { rows: best!.rows, cols: best!.cols }
}

export function layoutGrid(
  n: number,
  shape: CellShape,
  columns: number | 'Auto',
  rows: number | 'Auto',
  gap: number,
  box: Box
): GridLayout {
  const size = gridSize(n, shape, columns, rows, gap, box)
  const R = Math.max(1, size.rows)
  const C = Math.max(1, size.cols)
  const { cellW, cellH } = fit(R, C, CELL_ASPECT[shape], gap, box)
  const width = C * cellW + (C - 1) * gap
  const height = R * cellH + (R - 1) * gap
  const pitchX = cellW + gap
  const pitchY = cellH + gap
  const media = assignMedia(R, C, n)
  const cells: Cell[] = media.map((m, index) => {
    const row = Math.floor(index / C)
    const col = index % C
    return {
      index,
      media: m,
      row,
      col,
      x: -width / 2 + cellW / 2 + col * pitchX,
      y: height / 2 - cellH / 2 - row * pitchY,
    }
  })
  return { cells, rows: R, cols: C, cellW, cellH, gap, width, height, pitchX, pitchY }
}

// ── Which medium each cell shows ────────────────────────────────────────────────────────────
//
// With fewer media than cells the media repeat, spread like a Latin square:
// - every medium fills the same number of cells; when they don't divide evenly, the first media
//   (the lead) get one cell more;
// - no medium sits beside or above/below itself when that can be avoided (2 media: a
//   checkerboard; 3 in 3 × 3: every row and column holds each once), and diagonal neighbours and
//   copies in the same row or column are avoided next;
// - copies are otherwise as far apart as possible (a soft repulsion), so no corner collects one
//   medium;
// - media with the same count first appear in reading order (A before B before C…); without a
//   lead the top-left cell is the first medium.
// Found by descent on that cost (cell swaps, which keep the counts) from three starting orders,
// deterministic: the same media and grid always give the same pattern.
//
// e.g. 2 media in 3 × 2:  A B A     5 media in 4 × 4:  B A C D   (A 4 ×, once in every row and
//                         B A B                        D E B A    column; the others 3 ×; no
//                                                      A C D E    medium touches itself)
//                                                      E B A C
export function assignMedia(rows: number, cols: number, n: number): number[] {
  const N = rows * cols
  if (n <= 1) return new Array<number>(N).fill(0)
  if (n >= N) return Array.from({ length: N }, (_, i) => i)

  const row = (i: number) => Math.floor(i / cols)
  const col = (i: number) => i % cols
  // Cost of two cells showing the same medium.
  const cost: number[][] = Array.from({ length: N }, (_, a) =>
    Array.from({ length: N }, (_, b) => {
      if (a === b) return 0
      const dr = Math.abs(row(a) - row(b))
      const dc = Math.abs(col(a) - col(b))
      const d2 = dr * dr + dc * dc
      let e = 4 / d2
      if (d2 === 1)
        e += 100 // side by side / above and below
      else if (d2 === 2) e += 8 // diagonal
      if (dr === 0 || dc === 0) e += 0.5 // a stripe along a row or column
      return e
    })
  )
  // The media in reading order (i mod n): the first N mod n media (the lead) get the extra copy.
  const multiset = Array.from({ length: N }, (_, i) => i % n)
  const lead = N % n
  const orders = [
    Array.from({ length: N }, (_, i) => i), // rows
    Array.from({ length: N }, (_, i) => (i % rows) * cols + Math.floor(i / rows)), // columns
    Array.from({ length: N }, (_, i) => i).sort(
      (a, b) => row(a) + col(a) - (row(b) + col(b)) || row(a) - row(b)
    ), // diagonals
  ]
  const energyOf = (m: number[]) => {
    let e = 0
    for (let a = 0; a < N; a++) for (let b = a + 1; b < N; b++) if (m[a] === m[b]) e += cost[a]![b]!
    return e
  }
  // Sum of cell a's cost with the cells (other than `skip`) holding medium `k`.
  const costWith = (m: number[], a: number, k: number, skip: number) => {
    let e = 0
    for (let c = 0; c < N; c++) if (c !== a && c !== skip && m[c] === k) e += cost[a]![c]!
    return e
  }
  let best: { m: number[]; e: number } | null = null
  for (const order of orders) {
    const m = new Array<number>(N)
    order.forEach((cell, i) => (m[cell] = multiset[i]!))
    for (let pass = 0; pass < 60; pass++) {
      let improved = false
      for (let a = 0; a < N; a++) {
        for (let b = a + 1; b < N; b++) {
          const ka = m[a]!
          const kb = m[b]!
          if (ka === kb) continue
          const before = costWith(m, a, ka, b) + costWith(m, b, kb, a)
          const after = costWith(m, a, kb, b) + costWith(m, b, ka, a)
          if (after < before - 1e-9) {
            m[a] = kb
            m[b] = ka
            improved = true
          }
        }
      }
      if (!improved) break
    }
    const e = energyOf(m)
    if (!best || e < best.e - 1e-9) best = { m, e }
  }

  // Media with the same count are interchangeable: number them by first appearance in reading
  // order (the lead first).
  const next = [0, lead]
  const label = new Map<number, number>()
  return best!.m.map((k) => {
    if (!label.has(k)) label.set(k, next[k < lead ? 0 : 1]!++)
    return label.get(k)!
  })
}
