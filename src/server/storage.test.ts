import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type {
  AiUsage,
  CleanupPreview,
  CleanupResult,
  EmptyTrashResult,
  FontFolder,
  RestoreResult,
  StorageInfo,
  TrashListing,
} from '@shared/storage.ts'
import type { Asset, CaptureResult } from '@shared/types.ts'
import { ensureLibrary, fromLibraryPath, library, toLibraryPath } from './library.ts'
import { openDatabase } from './db/index.ts'
import { createApp } from './app.ts'

// Settings → Storage, "Clean up old renders", the Trash page, fonts and AI spend — end to end
// through the HTTP layer against the throwaway test library (see vitest.config.ts).
ensureLibrary()
const db = openDatabase()
const { app, processor } = createApp(db)

const get = async <T>(path: string) => (await (await app.request(`/api/${path}`)).json()) as T
const post = (path: string, body: unknown) =>
  app.request(`/api/${path}`, { method: 'POST', body: JSON.stringify(body) })

const DAY = 24 * 60 * 60 * 1000
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString()
const profileId = () =>
  (db.prepare("SELECT id FROM profiles WHERE slug = 'mario'").get() as { id: string }).id

// A story post whose current revision has these frames.
function makeStory(frames: { text: string }[], status = 'draft') {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO posts (id, profile_id, platform, format, status, current_revision_id, published_at)
     VALUES (?, ?, 'ig_story', 'story_seq', ?, ?, ?)`
  ).run(id, profileId(), status, `${id}-rev`, status === 'published' ? daysAgo(8) : null)
  db.prepare(
    `INSERT INTO post_revisions (id, post_id, segments, author) VALUES (?, ?, ?, 'me')`
  ).run(`${id}-rev`, id, JSON.stringify(frames.map((f) => ({ ...f, kind: 'text' }))))
  return id
}

// A finished render row with real files: MP4 (or JPEG), poster, and optionally a GIF export.
function makeRender(opts: {
  text: string
  createdAt: string
  postId?: string | null
  segmentIndex?: number | null
  gif?: boolean
}) {
  const id = randomUUID()
  const dir = join(library.renders, '2026', '09')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `text-story-${id.slice(0, 8)}.mp4`)
  const poster = join(dir, `text-story-${id.slice(0, 8)}.poster.jpg`)
  writeFileSync(file, Buffer.alloc(4000, 1))
  writeFileSync(poster, Buffer.alloc(300, 2))
  const gif = join(dir, `text-story-${id.slice(0, 8)}.480x853-15fps.gif`)
  if (opts.gif) writeFileSync(gif, Buffer.alloc(700, 3))
  const inputs = {
    aspect: '9:16',
    duration: 4,
    media: [],
    text: { body: opts.text },
    params: {},
    seed: 1,
  }
  db.prepare(
    `INSERT INTO renders (id, template_id, template_version, kind, aspect, width, height, fps,
       duration_ms, inputs, status, file_path, poster_path, size_bytes, post_id, segment_index, created_at)
     VALUES (?, 'text-story', 2, 'video', '9:16', 1080, 1920, 30, 4000, ?, 'ready', ?, ?, 4000, ?, ?, ?)`
  ).run(
    id,
    JSON.stringify(inputs),
    toLibraryPath(file),
    toLibraryPath(poster),
    opts.postId ?? null,
    opts.segmentIndex ?? null,
    opts.createdAt
  )
  return { id, file, poster, gif }
}

const renderExists = (id: string) => !!db.prepare('SELECT 1 FROM renders WHERE id = ?').get(id)

let colour = 0x102030
// A small PNG with unique content (so it never dedupes against another test's file).
function png(name: string) {
  const path = join(library.root, name)
  colour += 0x050301
  execFileSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=0x${colour.toString(16).padStart(6, '0')}:s=64x48`,
    '-frames:v',
    '1',
    path,
  ])
  return path
}

async function upload(path: string, name: string) {
  const res = await app.request('/api/assets/upload', {
    method: 'POST',
    body: new Uint8Array(readFileSync(path)),
    headers: { 'Content-Type': 'image/png', 'X-File-Name': name },
  })
  const { asset } = (await res.json()) as CaptureResult
  await processor.idle()
  return asset
}

describe('storage', () => {
  it('reports sizes per part of the library, renders and exports apart from originals', async () => {
    const before = await get<StorageInfo>('storage')
    const { id } = makeRender({ text: 'Sizes', createdAt: daysAgo(1), gif: true })
    const after = await get<StorageInfo>('storage')
    expect(after.renders.bytes - before.renders.bytes).toBe(4300) // MP4 + poster
    expect(after.exports.bytes - before.exports.bytes).toBe(700)
    expect(after.originals.bytes).toBe(before.originals.bytes) // media/renders isn't counted twice
    expect(after.database.files).toBeGreaterThan(0)
    expect(after.total).toBeGreaterThanOrEqual(after.renders.bytes + after.exports.bytes)
    db.prepare('DELETE FROM renders WHERE id = ?').run(id)
  })
})

describe('clean up old renders', () => {
  const story = makeStory([{ text: 'Current frame' }, { text: 'Second frame' }])
  const published = makeStory([{ text: 'Went out' }], 'published')

  const current = makeRender({
    text: 'Current frame',
    createdAt: daysAgo(10),
    postId: story,
    segmentIndex: 0,
  })
  // Same position, older text: superseded by `current`.
  const superseded = makeRender({
    text: 'Earlier wording',
    createdAt: daysAgo(12),
    postId: story,
    segmentIndex: 0,
    gif: true,
  })
  // Frame 2 has no matching render: its newest render at that position is still what it shows.
  const outdatedButShown = makeRender({
    text: 'Old second frame',
    createdAt: daysAgo(9),
    postId: story,
    segmentIndex: 1,
  })
  const studioOld = makeRender({ text: 'Studio test', createdAt: daysAgo(30) })
  const studioRecent = makeRender({ text: 'Studio today', createdAt: daysAgo(2) })
  const publishedOld = makeRender({
    text: 'Something else',
    createdAt: daysAgo(40),
    postId: published,
    segmentIndex: 0,
  })

  it('previews only old renders no frame uses and no published post links to (GET changes nothing)', async () => {
    const preview = await get<CleanupPreview>('storage/cleanup')
    const ids = preview.candidates.map((c) => c.id)
    expect(ids).toEqual(expect.arrayContaining([superseded.id, studioOld.id]))
    for (const kept of [current, outdatedButShown, studioRecent, publishedOld]) {
      expect(ids).not.toContain(kept.id)
    }
    const listed = preview.candidates.find((c) => c.id === superseded.id)!
    expect(listed).toMatchObject({ files: 3, bytes: 4000 + 300 + 700, postId: story })
    expect(preview.olderThanDays).toBe(7)
    expect(existsSync(superseded.file)).toBe(true)
    expect(renderExists(superseded.id)).toBe(true)
  })

  it('moves them to trash with their exports and record; skips what is no longer eligible', async () => {
    const res = await post('storage/cleanup', { ids: [superseded.id, studioOld.id, current.id] })
    expect(res.status).toBe(200)
    const result = (await res.json()) as CleanupResult
    expect(result).toMatchObject({ moved: 2, bytes: 5000 + 4300, skipped: [current.id] })

    for (const gone of [superseded.file, superseded.poster, superseded.gif, studioOld.file]) {
      expect(existsSync(gone)).toBe(false)
    }
    expect(renderExists(superseded.id)).toBe(false)
    expect(existsSync(current.file)).toBe(true)
    expect(renderExists(current.id)).toBe(true)

    const folder = join(library.trash, 'renders', superseded.id)
    expect(readdirSync(folder).sort()).toEqual(
      [
        'render.json',
        `text-story-${superseded.id.slice(0, 8)}.480x853-15fps.gif`,
        `text-story-${superseded.id.slice(0, 8)}.mp4`,
        `text-story-${superseded.id.slice(0, 8)}.poster.jpg`,
      ].sort()
    )
  })

  it('lists cleaned-up renders in the trash and restores one exactly as it was', async () => {
    const trash = await get<TrashListing>('storage/trash')
    const item = trash.items.find((i) => i.name === `renders/${superseded.id}`)!
    expect(item).toMatchObject({ kind: 'render', restorable: true, sizeBytes: 5000, files: 3 })
    expect(item.restoreNote).toMatch(/older render of its post/)

    const res = await post('storage/trash/restore', { name: item.name })
    expect(res.status).toBe(200)
    expect((await res.json()) as RestoreResult).toEqual({
      kind: 'render',
      renderId: superseded.id,
      postId: story,
    })
    for (const back of [superseded.file, superseded.poster, superseded.gif]) {
      expect(existsSync(back)).toBe(true)
    }
    const row = db.prepare('SELECT * FROM renders WHERE id = ?').get(superseded.id) as {
      post_id: string
      segment_index: number
      created_at: string
      status: string
    }
    expect(row).toMatchObject({ post_id: story, segment_index: 0, status: 'ready' })
    expect(existsSync(join(library.trash, 'renders', superseded.id))).toBe(false)
    // Still old and unused, so it is offered again.
    const again = await get<CleanupPreview>('storage/cleanup')
    expect(again.candidates.map((c) => c.id)).toContain(superseded.id)
  })

  it('refuses to restore over a file that has appeared in its place', async () => {
    writeFileSync(studioOld.file, 'something new')
    const res = await post('storage/trash/restore', { name: `renders/${studioOld.id}` })
    expect(res.status).toBe(409)
    expect(renderExists(studioOld.id)).toBe(false)
    expect(existsSync(join(library.trash, 'renders', studioOld.id, 'render.json'))).toBe(true)
  })
})

describe('trash', () => {
  it('restores a deleted original as a new asset in the Inbox', async () => {
    const asset = await upload(png('whiteboard.png'), 'whiteboard.png')
    const checksum = (
      db.prepare('SELECT checksum FROM assets WHERE id = ?').get(asset.id) as { checksum: string }
    ).checksum
    expect((await app.request(`/api/assets/${asset.id}`, { method: 'DELETE' })).status).toBe(204)

    const trashName = asset.file!.path.split('/').pop()!
    const item = (await get<TrashListing>('storage/trash')).items.find((i) => i.name === trashName)!
    expect(item).toMatchObject({ kind: 'original', label: 'whiteboard.png', restorable: true })

    const res = await post('storage/trash/restore', { name: trashName })
    expect(res.status).toBe(200)
    const result = (await res.json()) as RestoreResult
    expect(result.kind).toBe('asset')
    const restored = await get<Asset>(`assets/${(result as { assetId: string }).assetId}`)
    expect(restored).toMatchObject({ kind: 'image', triagedAt: null, source: 'inbox_folder' })
    expect(restored.file?.originalName).toBe('whiteboard.png')
    expect(existsSync(fromLibraryPath(restored.file!.path))).toBe(true)
    expect(existsSync(join(library.trash, trashName))).toBe(false)
    expect(
      (
        db.prepare('SELECT checksum FROM assets WHERE id = ?').get(restored.id) as {
          checksum: string
        }
      ).checksum
    ).toBe(checksum)

    // Gone from the trash now.
    expect((await post('storage/trash/restore', { name: trashName })).status).toBe(404)
  })

  it('restores a deleted Markdown note from its kept file', async () => {
    const res = await app.request('/api/assets/upload', {
      method: 'POST',
      body: Buffer.from('# Trash test\n\nBring this note back.'),
      headers: { 'Content-Type': 'text/markdown', 'X-File-Name': 'trash-test.md' },
    })
    const { asset } = (await res.json()) as CaptureResult
    expect(asset.kind).toBe('note')
    expect((await app.request(`/api/assets/${asset.id}`, { method: 'DELETE' })).status).toBe(204)

    const trashName = asset.file!.path.split('/').pop()!
    const item = (await get<TrashListing>('storage/trash')).items.find((i) => i.name === trashName)!
    expect(item).toMatchObject({ kind: 'original', label: 'trash-test.md', restorable: true })

    const restored = (await (
      await post('storage/trash/restore', { name: trashName })
    ).json()) as RestoreResult
    expect(restored.kind).toBe('asset')
    expect(await get<Asset>(`assets/${(restored as { assetId: string }).assetId}`)).toMatchObject({
      kind: 'note',
      body: '# Trash test\n\nBring this note back.',
    })
    expect(existsSync(join(library.trash, trashName))).toBe(false)
  })

  it('won’t restore a file that is already in the library', async () => {
    const source = png('duplicate.png')
    await upload(source, 'duplicate.png')
    const name = `${Date.now()}-duplicate.png`
    writeFileSync(join(library.trash, name), readFileSync(source))

    const item = (await get<TrashListing>('storage/trash')).items.find((i) => i.name === name)!
    expect(item).toMatchObject({ kind: 'duplicate', label: 'duplicate.png' })
    const res = await post('storage/trash/restore', { name })
    expect(res.status).toBe(409)
    expect(existsSync(join(library.trash, name))).toBe(true)
  })

  it('says honestly that a Studio-deleted render file can’t come back', async () => {
    const render = makeRender({ text: 'Deleted in the studio', createdAt: daysAgo(1) })
    expect((await app.request(`/api/renders/${render.id}`, { method: 'DELETE' })).status).toBe(204)
    const name = `render-${render.id.slice(0, 8)}-text-story-${render.id.slice(0, 8)}.mp4`
    const item = (await get<TrashListing>('storage/trash')).items.find((i) => i.name === name)!
    expect(item).toMatchObject({ kind: 'render-file', restorable: false })
    expect((await post('storage/trash/restore', { name })).status).toBe(409)
  })

  it('empties only the items it is given, and only inside the trash', async () => {
    const keep = 'keep-me.txt'
    const drop = 'drop-me.txt'
    writeFileSync(join(library.trash, keep), 'keep')
    writeFileSync(join(library.trash, drop), 'drop!')
    writeFileSync(join(library.root, 'outside.txt'), 'outside')

    for (const name of [
      '../outside.txt',
      'renders/../../outside.txt',
      '.hidden',
      'a/b/c',
      'renders',
      '',
    ]) {
      expect((await post('storage/trash/empty', { names: [name] })).status).toBe(400)
    }
    expect(existsSync(join(library.root, 'outside.txt'))).toBe(true)

    const res = await post('storage/trash/empty', { names: [drop, 'already-gone.txt'] })
    expect(res.status).toBe(200)
    expect((await res.json()) as EmptyTrashResult).toEqual({ removed: 1, bytes: 5 })
    expect(existsSync(join(library.trash, drop))).toBe(false)
    expect(existsSync(join(library.trash, keep))).toBe(true)

    // A cleaned-up render folder goes as one item.
    const old = makeRender({ text: 'Empty me', createdAt: daysAgo(20) })
    await post('storage/cleanup', { ids: [old.id] })
    const emptied = await post('storage/trash/empty', { names: [`renders/${old.id}`] })
    expect(((await emptied.json()) as EmptyTrashResult).removed).toBe(1)
    expect(existsSync(join(library.trash, 'renders', old.id))).toBe(false)
  })

  it('never deletes on GET', async () => {
    const res = await app.request('/api/storage/trash/empty')
    expect(res.status).toBe(404)
  })
})

describe('fonts and AI spend', () => {
  it('lists the font files in the library', async () => {
    writeFileSync(join(library.fonts, 'Test-Regular.otf'), Buffer.alloc(10))
    writeFileSync(join(library.fonts, '.DS_Store'), '')
    const fonts = await get<FontFolder>('system/fonts')
    expect(fonts.folder).toBe(library.fonts)
    expect(fonts.files).toContainEqual({ name: 'Test-Regular.otf', sizeBytes: 10 })
    expect(fonts.files.map((f) => f.name)).not.toContain('.DS_Store')
  })

  it('sums AI spend per month and per task, failed calls included', async () => {
    const run = db.prepare(
      `INSERT INTO ai_runs (id, task, prompt_version, provider, model, tokens_in, tokens_out,
         cost_usd, error, created_at) VALUES (?, ?, 'v1', 'fake', 'fake', ?, ?, ?, ?, ?)`
    )
    run.run(randomUUID(), 'spend-a', 1000, 200, 0.5, null, '2025-07-15T12:00:00.000Z')
    run.run(randomUUID(), 'spend-a', 3000, 100, 1.25, null, '2025-07-16T12:00:00.000Z')
    run.run(randomUUID(), 'spend-b', 500, 0, null, 'overloaded', '2025-07-17T12:00:00.000Z')
    run.run(randomUUID(), 'spend-a', 10, 20, 0.01, null, '2025-06-10T12:00:00.000Z')

    const usage = await get<AiUsage>('system/ai-usage')
    const july = usage.months.find((m) => m.month === '2025-07')!
    expect(july).toEqual({
      month: '2025-07',
      calls: 3,
      failed: 1,
      tokensIn: 4500,
      tokensOut: 300,
      costUsd: 1.75,
    })
    expect(usage.monthTasks.filter((t) => t.month === '2025-07')).toEqual([
      {
        month: '2025-07',
        task: 'spend-a',
        calls: 2,
        failed: 0,
        tokensIn: 4000,
        tokensOut: 300,
        costUsd: 1.75,
      },
      {
        month: '2025-07',
        task: 'spend-b',
        calls: 1,
        failed: 1,
        tokensIn: 500,
        tokensOut: 0,
        costUsd: 0,
      },
    ])
    const taskA = usage.tasks.find((t) => t.task === 'spend-a')!
    expect(taskA.calls).toBe(3)
    expect(taskA.costUsd).toBeCloseTo(1.76)
    // Newest month first.
    expect(usage.months.findIndex((m) => m.month === '2025-07')).toBeLessThan(
      usage.months.findIndex((m) => m.month === '2025-06')
    )
    expect(usage.total.calls).toBeGreaterThanOrEqual(4)
  })
})
