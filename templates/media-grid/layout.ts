// Grid layout for media-grid — pure functions (no three.js), in design px.
//
// Every cell has the same shape (Square / Desktop 16:10 / Mobile 9:19.5). The grid is laid out to
// fit a box on the frame (the story margins, minus the caption's room) exactly at the overview:
// one world unit = one design px when the camera shows the whole grid.
//
// Rows: with Auto columns the count is picked so the cells cover the most of the box (landscape
// cells in a story stack in one column, many phone cells spread wide…). When the media don't fill
// every row, the shortfall is spread symmetrically: short rows are centred (a half-cell offset),
// never a lonely last row — 8 media in 3 columns read [3, 2, 3], 10 read [2, 3, 3, 2].

export type CellShape = 'Square' | 'Desktop' | 'Mobile'

// Width / height.
export const CELL_ASPECT: Record<CellShape, number> = {
  Square: 1,
  Desktop: 16 / 10,
  Mobile: 9 / 19.5,
}

export interface Box {
  // Design px, frame coordinates (y down).
  x: number
  y: number
  w: number
  h: number
}

export interface Cell {
  index: number // media index (reading order)
  row: number
  col: number
  // Centre in world units (y up; the grid is centred on the origin).
  x: number
  y: number
}

export interface GridLayout {
  cells: Cell[]
  rows: number[] // media per row, top to bottom
  cellW: number
  cellH: number
  gap: number
  width: number // grid bounds
  height: number
  // Horizontal / vertical distance between neighbouring cell centres.
  pitchX: number
  pitchY: number
}

// Rows for n media, `cols` in the widest row and `extraRows` more rows than strictly needed, every
// row `cols` or one shorter, the short ones placed symmetrically. The extra row lets 7 read
// [1, 2, 1, 2, 1] instead of [2, 2, 1, 2]. Null when there is no such arrangement.
export function balancedRows(n: number, cols: number, extraRows = 0): number[] | null {
  const R = Math.ceil(n / cols) + extraRows
  const short = R * cols - n
  if (short < 0 || short >= R || (cols === 1 && short > 0)) return null
  if (!short) return Array(R).fill(cols)
  return placeShort(R, short, cols)
}

// Rows of exactly `cols` (the user asked for that many columns): the shortfall is spread one per
// row when it can be, else one short row at the bottom.
export function fixedRows(n: number, cols: number): number[] {
  const R = Math.ceil(n / cols)
  const deficit = R * cols - n
  if (!deficit) return Array(R).fill(cols)
  if (deficit < R) return placeShort(R, deficit, cols)
  return [...Array(R - 1).fill(cols), n - (R - 1) * cols]
}

// R rows of `long` media, `k` of them one shorter. Short rows go where they read as intended:
// never two short rows in a row when avoidable, mirrored top/bottom, long rows on the outside.
function placeShort(R: number, k: number, long: number): number[] {
  // Symmetric units: the centre row (odd R) and mirrored pairs.
  const units: number[][] = []
  if (R % 2) units.push([(R - 1) / 2])
  for (let i = Math.floor(R / 2) - 1; i >= 0; i--) units.push([i, R - 1 - i])
  let best: { rows: Set<number>; score: number } | null = null
  const total = 1 << units.length
  for (let mask = 0; mask < total; mask++) {
    const chosen = units.filter((_, i) => mask & (1 << i)).flat()
    if (chosen.length !== k) continue
    const rows = new Set(chosen)
    best = pickBetter(best, rows, R)
  }
  // No symmetric set of k rows (odd k, even R): short rows as low and even as possible.
  if (!best) {
    for (let mask = 0; mask < 1 << R; mask++) {
      const chosen = [...Array(R).keys()].filter((i) => mask & (1 << i))
      if (chosen.length !== k) continue
      best = pickBetter(best, new Set(chosen), R)
    }
  }
  const short = best!.rows
  return [...Array(R).keys()].map((i) => (short.has(i) ? long - 1 : long))
}

function pickBetter(
  best: { rows: Set<number>; score: number } | null,
  rows: Set<number>,
  R: number
) {
  let adjacent = 0
  for (const r of rows) if (rows.has(r + 1)) adjacent++
  const endsLong = (rows.has(0) ? 0 : 1) + (rows.has(R - 1) ? 0 : 1)
  // Then short rows nearer the middle, and (asymmetric sets) lower down, like a last row.
  let spread = 0
  for (const r of rows) spread += Math.abs(r - (R - 1) / 2)
  let low = 0
  for (const r of rows) low += r
  const score = adjacent * 1000 - endsLong * 100 + spread * 0.5 - low * 0.01
  return !best || score < best.score ? { rows, score } : best
}

// Cell size that fits rows × columns into the box.
function fit(rows: number[], aspect: number, gap: number, box: Box) {
  const cols = Math.max(...rows)
  const R = rows.length
  const byW = (box.w - (cols - 1) * gap) / cols
  const byH = ((box.h - (R - 1) * gap) / R) * aspect
  const cellW = Math.max(1, Math.min(byW, byH))
  return { cellW, cellH: cellW / aspect }
}

export function layoutGrid(
  n: number,
  shape: CellShape,
  columns: number | 'Auto',
  gap: number,
  box: Box
): GridLayout {
  const aspect = CELL_ASPECT[shape]
  let rows: number[]
  if (columns === 'Auto') {
    let best: { rows: number[]; score: number } | null = null
    const candidates: number[][] = []
    for (let c = 1; c <= Math.min(6, n); c++) {
      for (const extra of [0, 1]) {
        const rows = balancedRows(n, c, extra)
        if (rows) candidates.push(rows)
      }
    }
    for (const candidate of candidates) {
      const c = Math.max(...candidate)
      const { cellW, cellH } = fit(candidate, aspect, gap, box)
      const coverage = (n * cellW * cellH) / (box.w * box.h)
      const mirrored = candidate.every((r, i) => r === candidate[candidate.length - 1 - i])
      let score = coverage
      if (c === 1 && n >= 4) score *= 0.8 // a single column only when it clearly wins
      if (!mirrored) score *= 0.85
      if (!best || score > best.score + 1e-9) best = { rows: candidate, score }
    }
    rows = best!.rows
  } else {
    rows = fixedRows(n, Math.max(1, Math.min(columns, n)))
  }

  const { cellW, cellH } = fit(rows, aspect, gap, box)
  const cols = Math.max(...rows)
  const width = cols * cellW + (cols - 1) * gap
  const height = rows.length * cellH + (rows.length - 1) * gap
  const pitchX = cellW + gap
  const pitchY = cellH + gap
  const cells: Cell[] = []
  let index = 0
  rows.forEach((count, row) => {
    const y = height / 2 - cellH / 2 - row * pitchY
    const rowW = count * cellW + (count - 1) * gap
    for (let col = 0; col < count; col++) {
      cells.push({ index: index++, row, col, x: -rowW / 2 + cellW / 2 + col * pitchX, y })
    }
  })
  return { cells, rows, cellW, cellH, gap, width, height, pitchX, pitchY }
}
