import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Asset, CaptureResult } from '@shared/types.ts'
import { ensureLibrary, fromLibraryPath, library } from './library.ts'
import { openDatabase } from './db/index.ts'
import { createApp } from './app.ts'

// PDF, text and web-location capture, end to end through the HTTP layer (throwaway library).
ensureLibrary()
const { app, processor } = createApp(openDatabase())

// Builds a PDF with PDFKit: `pages` pages of 300×400 pt, the second one rotated 90°, optionally
// locked with a password.
const MAKE_PDF = `
ObjC.import('Quartz'); ObjC.import('AppKit')
function run(argv) {
  const [out, n, password] = [argv[0], Number(argv[1]), argv[2]]
  const doc = $.PDFDocument.alloc.init
  for (let i = 0; i < n; i++) {
    const img = $.NSImage.alloc.initWithSize($.NSMakeSize(300, 400))
    img.lockFocus
    $.NSColor.colorWithCalibratedRedGreenBlueAlpha(0.9, 0.3, 0.5, 1).setFill
    $.NSRectFill($.NSMakeRect(20, 20, 100, 200))
    img.unlockFocus
    const page = $.PDFPage.alloc.initWithImage(img)
    if (i === 1) page.rotation = 90
    doc.insertPageAtIndex(page, i)
  }
  if (!password) return doc.writeToFile(out)
  const opts = $.NSMutableDictionary.alloc.init
  opts.setObjectForKey($(password), $('PDFDocumentUserPasswordOption'))
  opts.setObjectForKey($(password + '-owner'), $('PDFDocumentOwnerPasswordOption'))
  return doc.writeToFileWithOptions(out, opts)
}
`
const makePdf = (path: string, pages: number, password = '') =>
  execFileSync('osascript', ['-l', 'JavaScript', '-e', MAKE_PDF, path, String(pages), password])

const fixtures = join(library.root, 'pdf-fixtures')
const threePages = join(fixtures, 'award.pdf')
const locked = join(fixtures, 'locked.pdf')
const long = join(fixtures, 'long.pdf')

beforeAll(() => {
  rmSync(fixtures, { recursive: true, force: true })
  execFileSync('mkdir', ['-p', fixtures])
  makePdf(threePages, 3)
  makePdf(locked, 1, 'secret')
  makePdf(long, 52)
})

const upload = (bytes: Buffer, name: string, headers: Record<string, string> = {}) =>
  app.request('/api/assets/upload', {
    method: 'POST',
    body: new Uint8Array(bytes),
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(bytes.length),
      'X-File-Name': encodeURIComponent(name),
      'X-Last-Modified': String(Date.UTC(2026, 8, 21, 9)),
      'X-Source': 'drop',
      ...headers,
    },
  })

const get = async <T>(path: string) => (await (await app.request(path)).json()) as T
const pngSize = (path: string) => {
  const bytes = readFileSync(path)
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25] }
}

describe('PDF import', () => {
  let first: Asset

  it('keeps the PDF and makes one image asset per page', async () => {
    const res = await upload(readFileSync(threePages), 'Award 2026.pdf')
    expect(res.status).toBe(201)
    const result = (await res.json()) as CaptureResult
    expect(result).toMatchObject({ duplicate: false, pages: 3 })
    first = result.asset
    expect(first).toMatchObject({ kind: 'image', title: 'Award 2026.pdf — page 1' })
    expect(first.file).toMatchObject({
      mime: 'image/png',
      originalName: 'Award 2026.pdf (page 1).png',
    })
    expect(first.file?.path).toMatch(/^media\/2026\/09\/award-2026-[0-9a-f]{8}-p001\.png$/)
    expect(first.pdf).toMatchObject({ name: 'Award 2026.pdf', page: 1 })

    // The PDF itself sits next to its pages, unchanged.
    const pdfPath = first.file!.path.replace(/-p001\.png$/, '.pdf')
    expect(first.pdf!.url).toBe(`/api/files/${pdfPath}`)
    expect(readFileSync(fromLibraryPath(pdfPath)).equals(readFileSync(threePages))).toBe(true)
    expect(readdirSync(library.tmp)).toEqual([])

    await processor.idle()
    const all = await get<Asset[]>('/api/assets?q=Award%202026')
    const pages = all.filter((a) => a.pdf?.name === 'Award 2026.pdf')
    // Listed in page order, each ready with a thumbnail.
    expect(pages.map((a) => a.pdf!.page)).toEqual([1, 2, 3])
    for (const page of pages) {
      expect(page.processingStatus).toBe('ready')
      expect(page.thumbUrl).toBeTruthy()
    }

    // 3000 px on the long side, opaque RGB, the rotated page landscape.
    expect(pngSize(fromLibraryPath(pages[0]!.file!.path))).toEqual({
      width: 2250,
      height: 3000,
      colorType: 2,
    })
    expect(pages[1]!.file).toMatchObject({ width: 3000, height: 2250 })
  })

  it('serves the PDF and gives templates the page image', async () => {
    const pdf = await app.request(first.pdf!.url)
    expect(pdf.status).toBe(200)
    const source = await get<{ url: string; kind: string }>(`/api/assets/${first.id}/render-source`)
    expect(source).toMatchObject({ kind: 'image', url: first.file!.url })
  })

  it('detects a re-import of the same PDF', async () => {
    const res = await upload(readFileSync(threePages), 'award copy.pdf')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ duplicate: true, pages: 3, asset: { id: first.id } })
  })

  it('assigns the project it was captured on', async () => {
    const project = (await (
      await app.request('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name: 'Awards' }),
      })
    ).json()) as { id: string }
    const bytes = Buffer.concat([readFileSync(threePages), Buffer.from('\n% another copy\n')])
    const res = await upload(bytes, 'award-v2.pdf', { 'X-Project-Id': project.id })
    const result = (await res.json()) as CaptureResult
    expect(result.asset.projectId).toBe(project.id)
    const inProject = await get<Asset[]>(`/api/assets?project=${project.id}`)
    expect(inProject).toHaveLength(3)
  })

  it('fails readably for locked and unreadable PDFs', async () => {
    const lockedRes = await upload(readFileSync(locked), 'locked.pdf')
    expect(lockedRes.status).toBe(422)
    expect(((await lockedRes.json()) as { error: string }).error).toMatch(/password-protected/)

    const bad = await upload(Buffer.from('%PDF-1.7 not really'), 'brief.pdf')
    expect(bad.status).toBe(422)
    expect(((await bad.json()) as { error: string }).error).toMatch(/Couldn't read “brief.pdf”/)
    expect(readdirSync(library.tmp)).toEqual([])
  })

  it('imports at most 50 pages and says so', async () => {
    const res = await upload(readFileSync(long), 'catalogue.pdf')
    const result = (await res.json()) as CaptureResult
    expect(result.pages).toBe(50)
    expect(result.message).toMatch(/first 50 of 52 pages/)
  }, 120_000)

  it('moves the PDF to trash with its last page', async () => {
    const pages = (await get<Asset[]>('/api/assets?q=award-v2')).filter((a) => a.pdf)
    expect(pages).toHaveLength(3)
    const pdfFile = fromLibraryPath(pages[0]!.file!.path.replace(/-p\d+\.png$/, '.pdf'))
    for (const [i, page] of pages.entries()) {
      expect((await app.request(`/api/assets/${page.id}`, { method: 'DELETE' })).status).toBe(204)
      // Still in media/ until no page is left.
      expect(existsSync(pdfFile)).toBe(i < pages.length - 1)
    }
    expect(existsSync(join(library.trash, pdfFile.split('/').pop()!))).toBe(true)
  })
})

describe('text files and web locations', () => {
  it('turns a Markdown file into a note and keeps the file', async () => {
    const res = await upload(Buffer.from('# Launch notes\n\nShip the award page.'), 'launch.md')
    expect(res.status).toBe(201)
    const { asset } = (await res.json()) as CaptureResult
    expect(asset).toMatchObject({
      kind: 'note',
      title: 'launch',
      body: '# Launch notes\n\nShip the award page.',
      processingStatus: 'ready',
    })
    expect(asset.file?.path).toMatch(/^media\/2026\/09\/launch-[0-9a-f]{8}\.md$/)

    const again = await upload(Buffer.from('# Launch notes\n\nShip the award page.'), 'copy.md')
    expect(await again.json()).toMatchObject({ duplicate: true, asset: { id: asset.id } })
  })

  it('turns a .webloc into a link', async () => {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>URL</key><string>http://127.0.0.1:9/work?a=1&amp;b=2</string></dict></plist>`
    const res = await upload(Buffer.from(plist), 'Case study.webloc')
    expect(res.status).toBe(201)
    const { asset } = (await res.json()) as CaptureResult
    expect(asset).toMatchObject({
      kind: 'link',
      title: 'Case study',
      link: { url: 'http://127.0.0.1:9/work?a=1&b=2' },
    })
  })

  it('rejects empty text files and web locations without a URL', async () => {
    expect((await upload(Buffer.from('  \n'), 'empty.txt')).status).toBe(422)
    const res = await upload(Buffer.from('<plist><dict></dict></plist>'), 'odd.webloc')
    expect(res.status).toBe(422)
  })

  it('still rejects other file types', async () => {
    const res = await upload(Buffer.from('PK'), 'archive.zip')
    expect(res.status).toBe(415)
  })
})

describe('link previews that fail', () => {
  it('keeps the link usable and says why there is no preview', async () => {
    // A site that refuses bots.
    const server = createServer((_req, res) => res.writeHead(403).end('Forbidden'))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const url = `http://127.0.0.1:${port}/blocked`
    try {
      const created = await app.request('/api/assets/link', {
        method: 'POST',
        body: JSON.stringify({ url, title: 'Reference site' }),
      })
      const { asset } = (await created.json()) as CaptureResult
      await processor.idle()
      const link = await get<Asset>(`/api/assets/${asset.id}`)
      expect(link.processingStatus).toBe('ready')
      expect(link.link?.meta).toMatchObject({ url, title: null, siteName: '127.0.0.1' })
      expect(link.link?.meta?.error).toBe('The site blocks automatic previews (HTTP 403).')

      // Retry fetches again and stays usable.
      await app.request(`/api/assets/${asset.id}/reprocess`, { method: 'POST' })
      await processor.idle()
      expect((await get<Asset>(`/api/assets/${asset.id}`)).processingStatus).toBe('ready')
    } finally {
      server.close()
    }
  })
})

describe('missing cache files', () => {
  it('rebuilds thumbnails deleted from cache/', async () => {
    const png = join(fixtures, 'frame.png')
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=800x600',
      '-frames:v',
      '1',
      png,
    ])
    const { asset } = (await (await upload(readFileSync(png), 'frame.png')).json()) as CaptureResult
    await processor.idle()
    const before = await get<Asset>(`/api/assets/${asset.id}`)
    expect(before.thumbUrl).toBeTruthy()

    rmSync(join(library.cache, asset.id), { recursive: true, force: true })
    expect((await app.request(before.thumbUrl!)).status).not.toBe(200)

    const repair = await app.request(`/api/assets/${asset.id}/repair`, { method: 'POST' })
    expect(await repair.json()).toEqual({ queued: true })
    await processor.idle()
    const after = await get<Asset>(`/api/assets/${asset.id}`)
    expect((await app.request(after.thumbUrl!)).status).toBe(200)

    // Nothing missing: nothing to do.
    const again = await app.request(`/api/assets/${asset.id}/repair`, { method: 'POST' })
    expect(await again.json()).toEqual({ queued: false })
  })

  it('rebuilds a video proxy whose file is gone', async () => {
    const video = join(fixtures, 'clip.mp4')
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=2:size=320x240:rate=24',
      '-pix_fmt',
      'yuv420p',
      video,
    ])
    const { asset } = (await (
      await upload(readFileSync(video), 'clip.mp4')
    ).json()) as CaptureResult
    await processor.idle()
    const first = await get<{ url: string }>(`/api/assets/${asset.id}/render-source`)
    expect((await app.request(first.url)).status).toBe(200)

    // "cache/ is safe to delete".
    rmSync(join(library.cache, asset.id), { recursive: true, force: true })
    const second = await get<{ url: string }>(`/api/assets/${asset.id}/render-source`)
    expect(second.url).not.toBe(first.url)
    expect((await app.request(second.url)).status).toBe(200)

    // The startup check finds the missing thumbnail and frames.
    expect(processor.repairMissing()).toContain(asset.id)
    await processor.idle()
    const rebuilt = await get<Asset>(`/api/assets/${asset.id}`)
    expect((await app.request(rebuilt.thumbUrl!)).status).toBe(200)
  })
})
