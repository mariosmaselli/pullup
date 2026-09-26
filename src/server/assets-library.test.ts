import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type {
  Asset,
  AssetUsage,
  BulkDeleteResult,
  CaptureResult,
  InboxIssue,
  Project,
  TagCount,
} from '@shared/types.ts'
import { ensureLibrary, library } from './library.ts'
import { openDatabase } from './db/index.ts'
import { createApp } from './app.ts'
import { watchInbox } from './services/inbox-watcher.ts'
import type { AiProvider, AiRequest } from './ai/provider.ts'

// Library search/filters, tags, bulk actions, "used in" and the inbox folder's problem files.
ensureLibrary()
const db = openDatabase()
const { app, capture, processor } = createApp(db)

const json = (body: unknown, method = 'POST') => ({ method, body: JSON.stringify(body) })
const get = async <T>(path: string) => (await (await app.request(path)).json()) as T
const note = async (body: string, extra: Record<string, unknown> = {}) =>
  (
    (await (
      await app.request('/api/assets/note', json({ body, ...extra }))
    ).json()) as CaptureResult
  ).asset
const patch = (id: string, body: Record<string, unknown>) =>
  app.request(`/api/assets/${id}`, json(body, 'PATCH'))
const ids = (assets: Asset[]) => assets.map((a) => a.id).sort()

let project: Project
let grass: Asset
let shader: Asset
let loose: Asset

describe('library search and filters', () => {
  it('captures into the project it was made on', async () => {
    project = (await (
      await app.request('/api/projects', json({ name: 'Grass study' }))
    ).json()) as Project
    grass = await note('Instanced grass with wind — 2M blades', { projectId: project.id })
    expect(grass.projectId).toBe(project.id)
    // An unknown project never blocks a capture.
    loose = await note('Loose thought about pricing', { projectId: 'gone' })
    expect(loose.projectId).toBeNull()
    const link = (await (
      await app.request(
        '/api/assets/link',
        json({ url: 'http://127.0.0.1:9/shaders', title: 'Shader notes', projectId: project.id })
      )
    ).json()) as CaptureResult
    shader = link.asset
    expect(shader.projectId).toBe(project.id)
  })

  it('edits tags, trimmed and without repeats', async () => {
    const res = await patch(grass.id, { tags: [' WebGL ', 'webgl', 'grass  study', ''] })
    expect(((await res.json()) as Asset).tags).toEqual(['WebGL', 'grass study'])
    await patch(shader.id, { tags: ['webgl'] })
    expect(await get<TagCount[]>('/api/assets/tags')).toEqual(
      expect.arrayContaining([
        { tag: 'WebGL', count: 2 },
        { tag: 'grass study', count: 1 },
      ])
    )
  })

  it('searches title, notes, note text and link URL, all words', async () => {
    await patch(loose.id, { notes: 'from the Tallinn meetup' })
    expect(ids(await get<Asset[]>('/api/assets?q=GRASS%20wind'))).toEqual([grass.id])
    expect(ids(await get<Asset[]>('/api/assets?q=tallinn'))).toEqual([loose.id])
    expect(ids(await get<Asset[]>('/api/assets?q=127.0.0.1%3A9%2Fshaders'))).toEqual([shader.id])
    expect(ids(await get<Asset[]>('/api/assets?q=grass%20pricing'))).toEqual([])
    // LIKE wildcards are literal.
    expect(await get<Asset[]>('/api/assets?q=%25')).toEqual([])
  })

  it('filters by kind, project (or none), visibility and tag', async () => {
    const inProject = await get<Asset[]>(`/api/assets?project=${project.id}`)
    expect(ids(inProject)).toEqual(ids([grass, shader]))
    const unassigned = await get<Asset[]>('/api/assets?project=none')
    expect(unassigned.some((a) => a.id === loose.id)).toBe(true)
    expect(unassigned.every((a) => a.projectId === null)).toBe(true)

    const links = await get<Asset[]>(`/api/assets?kind=link&project=${project.id}`)
    expect(ids(links)).toEqual([shader.id])
    expect(ids(await get<Asset[]>('/api/assets?tag=webgl'))).toEqual(ids([grass, shader]))

    await patch(grass.id, { visibility: 'approved' })
    const approved = await get<Asset[]>(`/api/assets?visibility=approved&project=${project.id}`)
    expect(ids(approved)).toEqual([grass.id])
    // Nonsense values are ignored, not errors.
    expect((await app.request('/api/assets?kind=pdf&visibility=x')).status).toBe(200)
  })
})

describe('bulk actions', () => {
  it('assigns a project and marks reviewed in one go', async () => {
    const a = await note('bulk one')
    const b = await note('bulk two')
    await patch(b.id, { triaged: true })
    const reviewedAt = (await get<Asset>(`/api/assets/${b.id}`)).triagedAt

    const res = await app.request(
      '/api/assets/bulk',
      json({ ids: [a.id, b.id, 'missing'], projectId: project.id, triaged: true })
    )
    expect(await res.json()).toEqual({ updated: 2 })
    const [one, two] = [
      await get<Asset>(`/api/assets/${a.id}`),
      await get<Asset>(`/api/assets/${b.id}`),
    ]
    expect(one).toMatchObject({ projectId: project.id })
    expect(one.triagedAt).toBeTruthy()
    // Already reviewed: keeps its first review time.
    expect(two.triagedAt).toBe(reviewedAt)

    const unknown = await app.request('/api/assets/bulk', json({ ids: [a.id], projectId: 'nope' }))
    expect(unknown.status).toBe(400)
  })

  it('lists where an asset is used and explains blocked deletes', async () => {
    // A post showing `grass` and an idea citing it.
    db.prepare(
      `INSERT INTO posts (id, profile_id, platform, format, status)
       VALUES ('post-1', '00000000-0000-4000-8000-000000000001', 'x', 'single', 'draft')`
    ).run()
    db.prepare(
      `INSERT INTO post_revisions (id, post_id, segments, author)
       VALUES ('rev-1', 'post-1', ?, 'me')`
    ).run(JSON.stringify([{ text: 'Two million blades of grass, instanced.' }]))
    db.prepare("UPDATE posts SET current_revision_id = 'rev-1' WHERE id = 'post-1'").run()
    db.prepare("INSERT INTO post_media (post_id, asset_id) VALUES ('post-1', ?)").run(grass.id)
    db.prepare(
      "INSERT INTO ideas (id, title, origin, status) VALUES ('idea-1', 'Grass at scale', 'asset', 'saved')"
    ).run()
    db.prepare("INSERT INTO idea_sources (idea_id, asset_id) VALUES ('idea-1', ?)").run(grass.id)

    expect(await get<AssetUsage>(`/api/assets/${grass.id}/usage`)).toEqual({
      posts: [
        {
          id: 'post-1',
          platform: 'x',
          status: 'draft',
          excerpt: 'Two million blades of grass, instanced.',
        },
      ],
      ideas: [{ id: 'idea-1', title: 'Grass at scale', status: 'saved' }],
    })

    const blocked = await app.request(`/api/assets/${grass.id}`, { method: 'DELETE' })
    expect(blocked.status).toBe(409)
    expect(await blocked.json()).toMatchObject({
      error: 'Used in 1 post (draft). Remove it from that post first.',
      posts: [{ id: 'post-1' }],
    })

    const res = await app.request('/api/assets/bulk-delete', json({ ids: [grass.id, loose.id] }))
    const result = (await res.json()) as BulkDeleteResult
    expect(result.deleted).toEqual([loose.id])
    expect(result.blocked).toEqual([
      {
        id: grass.id,
        title: 'Instanced grass with wind — 2M blades',
        reason: expect.stringMatching(/^Used in 1 post/),
      },
    ])
    expect((await app.request(`/api/assets/${loose.id}`)).status).toBe(404)
  })
})

describe('inbox folder', () => {
  const watcher = watchInbox(capture)
  afterAll(() => watcher.close())

  const waitFor = async <T>(check: () => Promise<T | undefined | false>, ms = 10_000) => {
    const end = Date.now() + ms
    for (;;) {
      const value = await check()
      if (value) return value
      if (Date.now() > end) throw new Error('timed out')
      await new Promise((r) => setTimeout(r, 200))
    }
  }

  it('imports text and lists files it can’t import, with the reason', async () => {
    writeFileSync(join(library.inbox, 'standup.txt'), 'Talked about the grass wind shader.')
    writeFileSync(join(library.inbox, 'slides.key'), 'not really keynote')
    writeFileSync(join(library.inbox, 'broken.pdf'), '%PDF-1.4 truncated')

    const issues = await waitFor(async () => {
      const list = await get<InboxIssue[]>('/api/assets/inbox-issues')
      return list.length === 2 && list
    })
    const byName = Object.fromEntries(issues.map((i) => [i.name, i.reason]))
    expect(byName['slides.key']).toMatch(/can't import \.key files/)
    expect(byName['broken.pdf']).toMatch(/Couldn't read “broken.pdf”/)

    const imported = await waitFor(async () =>
      (await get<Asset[]>('/api/assets?q=grass%20wind%20shader')).find((a) => a.kind === 'note')
    )
    expect(imported).toMatchObject({ title: 'standup', source: 'inbox_folder' })
    expect(existsSync(join(library.inbox, 'standup.txt'))).toBe(false)
  })

  it('moves a listed file to trash on request, and nothing else', async () => {
    const outside = await app.request(
      '/api/assets/inbox-issues/trash',
      json({ name: '../pullup.db' })
    )
    expect(outside.status).toBe(404)
    const res = await app.request('/api/assets/inbox-issues/trash', json({ name: 'slides.key' }))
    expect(res.status).toBe(200)
    expect(existsSync(join(library.inbox, 'slides.key'))).toBe(false)
    expect(readdirSync(library.trash).some((n) => n.endsWith('-slides.key'))).toBe(true)
    expect((await get<InboxIssue[]>('/api/assets/inbox-issues')).map((i) => i.name)).toEqual([
      'broken.pdf',
    ])
  })

  it('drops a file from the list once it is fixed', async () => {
    // Replace the broken PDF with a real one, then retry.
    execFileSync('osascript', [
      '-l',
      'JavaScript',
      '-e',
      `ObjC.import('Quartz'); ObjC.import('AppKit')
       function run(argv) {
         const doc = $.PDFDocument.alloc.init
         const img = $.NSImage.alloc.initWithSize($.NSMakeSize(200, 100))
         img.lockFocus
         $.NSColor.blueColor.setFill
         $.NSRectFill($.NSMakeRect(10, 10, 50, 50))
         img.unlockFocus
         doc.insertPageAtIndex($.PDFPage.alloc.initWithImage(img), 0)
         return doc.writeToFile(argv[0])
       }`,
      join(library.root, 'fixed.pdf'),
    ])
    execFileSync('mv', [join(library.root, 'fixed.pdf'), join(library.inbox, 'broken.pdf')])
    await app.request('/api/assets/inbox-issues/retry', json({ name: 'broken.pdf' }))
    await waitFor(async () => !(await get<InboxIssue[]>('/api/assets/inbox-issues')).length)
    const pages = await get<Asset[]>('/api/assets?q=broken.pdf')
    expect(pages.map((p) => p.title)).toEqual(['broken.pdf — page 1'])
  })
})

describe('links without a preview', () => {
  // A fake provider that records what it was sent.
  const sent: AiRequest<unknown>[] = []
  const fake: AiProvider = {
    name: 'fake',
    model: 'fake-model',
    async generate<T>(request: AiRequest<T>) {
      sent.push(request as AiRequest<unknown>)
      return {
        output: request.schema.parse({
          description: 'A reference site about harbor lighting.',
          subjects: ['harbor'],
          suggestedTags: ['reference'],
          suggestedProjectId: null,
          hooks: [],
          questions: [],
        }),
        model: 'fake-model',
        usage: { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
        // Test files share one database: priced like ai.test.ts's fake, whose run checks read it.
        costUsd: 0.01,
      }
    },
  }
  const withAi = createApp(db, { provider: fake }).app

  it('can still be analyzed, from its URL and Mario’s title', async () => {
    const server = createServer((_req, res) => res.writeHead(403).end())
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/harbor`
    try {
      const { asset } = (await (
        await app.request('/api/assets/link', json({ url, title: 'Harbor lighting reference' }))
      ).json()) as CaptureResult
      await processor.idle()
      expect((await get<Asset>(`/api/assets/${asset.id}`)).link?.meta?.error).toMatch(/403/)

      const res = await withAi.request(`/api/assets/${asset.id}/analyze`, { method: 'POST' })
      expect(res.status).toBe(200)
      expect(((await res.json()) as Asset).analysis?.suggestedTags).toEqual(['reference'])
      const text = sent
        .at(-1)!
        .content.map((c) => (c.type === 'text' ? c.text : ''))
        .join('\n')
      expect(text).toContain(`URL: ${url}`)
      expect(text).toContain('Title (by Mario): Harbor lighting reference')
    } finally {
      server.close()
    }
  })
})

describe('library files', () => {
  it('answers 404, not 500, for a file that is gone', async () => {
    const res = await app.request('/api/files/media/2026/09/not-here.png')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found' })
  })
})
