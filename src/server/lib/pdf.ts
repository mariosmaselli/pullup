import { execFile } from 'node:child_process'
import { join } from 'node:path'

// PDF pages → PNG images with macOS PDFKit, driven through `osascript -l JavaScript` (no
// dependency). Each page is drawn on white into an opaque sRGB bitmap, `longSide` px on its
// longer side (crop box, page rotation applied), and written with ImageIO.

export const PDF_MAX_PAGES = 50
export const PDF_LONG_SIDE = 3000
// Pages per osascript process: JXA frees bitmaps only when the process ends (~20 MB a page).
const BATCH = 8

export class PdfError extends Error {}

export interface RenderedPage {
  page: number // 1-based
  path: string
  width: number
  height: number
}

export interface PdfRender {
  pageCount: number
  pages: RenderedPage[]
}

// argv: input, output folder, long side, first page (0-based), end page (exclusive).
// Prints JSON: { pageCount, pages: [{ page, file, width, height }] } or { error }.
const SCRIPT = `
ObjC.import('Quartz'); ObjC.import('CoreGraphics'); ObjC.import('ImageIO')
function run(argv) {
  const [input, outDir] = [argv[0], argv[1]]
  const [longSide, first, end] = [Number(argv[2]), Number(argv[3]), Number(argv[4])]
  const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(input))
  if (!doc || doc.isNil()) return JSON.stringify({ error: 'unreadable' })
  if (doc.isLocked) return JSON.stringify({ error: 'locked' })
  const pageCount = Number(doc.pageCount)
  const sRGB = $.CGColorSpaceCreateWithName($.kCGColorSpaceSRGB)
  const pages = []
  for (let i = first; i < Math.min(end, pageCount); i++) {
    const page = doc.pageAtIndex(i)
    if (!page || page.isNil()) return JSON.stringify({ error: 'page', page: i + 1 })
    const box = page.boundsForBox($.kPDFDisplayBoxCropBox)
    const turned = Number(page.rotation) % 180 !== 0
    const bw = turned ? box.size.height : box.size.width
    const bh = turned ? box.size.width : box.size.height
    if (!(bw > 0 && bh > 0)) return JSON.stringify({ error: 'page', page: i + 1 })
    const scale = longSide / Math.max(bw, bh)
    const w = Math.max(1, Math.round(bw * scale))
    const h = Math.max(1, Math.round(bh * scale))
    // 5 = kCGImageAlphaNoneSkipLast: opaque RGB, no alpha channel in the PNG.
    const ctx = $.CGBitmapContextCreate(null, w, h, 8, 0, sRGB, 5)
    if (!ctx) return JSON.stringify({ error: 'memory', page: i + 1 })
    $.CGContextSetRGBFillColor(ctx, 1, 1, 1, 1)
    $.CGContextFillRect(ctx, $.CGRectMake(0, 0, w, h))
    $.CGContextScaleCTM(ctx, scale, scale)
    page.drawWithBoxToContext($.kPDFDisplayBoxCropBox, ctx)
    const image = $.CGBitmapContextCreateImage(ctx)
    const file = outDir + '/page-' + (i + 1) + '.png'
    const dest = $.CGImageDestinationCreateWithURL($.NSURL.fileURLWithPath(file), $('public.png'), 1, null)
    $.CGImageDestinationAddImage(dest, image, null)
    const ok = $.CGImageDestinationFinalize(dest)
    $.CGImageRelease(image)
    $.CGContextRelease(ctx)
    if (!ok) return JSON.stringify({ error: 'write', page: i + 1 })
    pages.push({ page: i + 1, file, width: w, height: h })
  }
  return JSON.stringify({ pageCount, pages })
}
`

interface ScriptResult {
  pageCount?: number
  pages?: { page: number; file: string; width: number; height: number }[]
  error?: 'unreadable' | 'locked' | 'page' | 'memory' | 'write'
  page?: number
}

function osascript(args: string[], timeoutMs: number): Promise<ScriptResult> {
  return new Promise((resolve, reject) => {
    execFile(
      'osascript',
      ['-l', 'JavaScript', '-e', SCRIPT, ...args],
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const e = err as NodeJS.ErrnoException & { killed?: boolean }
          if (e.code === 'ENOENT')
            return reject(new PdfError('PDF import needs macOS (osascript).'))
          if (e.killed) return reject(new PdfError('Rendering the PDF took too long.'))
          const detail = stderr.trim().split('\n').pop() ?? ''
          return reject(new PdfError(`Rendering the PDF failed${detail ? `: ${detail}` : ''}`))
        }
        try {
          resolve(JSON.parse(stdout.trim()) as ScriptResult)
        } catch {
          reject(new PdfError('Rendering the PDF failed: unexpected output'))
        }
      }
    )
  })
}

function explain(result: ScriptResult, name: string): PdfError {
  switch (result.error) {
    case 'locked':
      return new PdfError(
        `“${name}” is password-protected. Open it in Preview, export an unlocked copy and add that.`
      )
    case 'unreadable':
      return new PdfError(`Couldn't read “${name}” — it may be damaged or not really a PDF.`)
    case 'memory':
      return new PdfError(`Page ${result.page} of “${name}” is too large to render.`)
    case 'write':
      return new PdfError(`Couldn't save page ${result.page} of “${name}”.`)
    default:
      return new PdfError(`Couldn't render page ${result.page ?? '?'} of “${name}”.`)
  }
}

// Renders up to `maxPages` pages of `input` into `outDir` as page-<n>.png.
export async function renderPdfPages(
  input: string,
  outDir: string,
  {
    name = 'PDF',
    longSide = PDF_LONG_SIDE,
    maxPages = PDF_MAX_PAGES,
  }: { name?: string; longSide?: number; maxPages?: number } = {}
): Promise<PdfRender> {
  const pages: RenderedPage[] = []
  let pageCount = Infinity
  for (let first = 0; first < Math.min(pageCount, maxPages); first += BATCH) {
    const end = Math.min(first + BATCH, maxPages)
    const result = await osascript(
      [input, outDir, String(longSide), String(first), String(end)],
      30_000 + (end - first) * 10_000
    )
    if (result.error) throw explain(result, name)
    pageCount = result.pageCount ?? 0
    for (const p of result.pages ?? []) {
      pages.push({
        page: p.page,
        path: join(outDir, `page-${p.page}.png`),
        width: p.width,
        height: p.height,
      })
    }
  }
  if (!pageCount) throw new PdfError(`“${name}” has no pages.`)
  return { pageCount, pages }
}
