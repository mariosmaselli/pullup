import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Asset, CaptureResult, Post, PostDetail, Project } from '@shared/types.ts'
import type { AiProvider, AiRequest } from './ai/provider.ts'
import { ensureLibrary, library } from './library.ts'
import { openDatabase } from './db/index.ts'
import { createApp } from './app.ts'

// Posts made by hand (blank drafts, logged posts), attached media, the status workflow,
// planning, claim check-offs and projects. No test here reaches a real AI provider.

const calls: AiRequest<unknown>[] = []
const fake: AiProvider = {
  name: 'fake',
  model: 'fake-model',
  async generate<T>(request: AiRequest<T>) {
    calls.push(request as AiRequest<unknown>)
    return {
      output: request.schema.parse({
        format: 'single',
        segments: [{ text: 'Revised by the fake', assetId: null, kind: null }],
        caption: null,
        claims: [],
        questions: [],
      }),
      model: 'fake-model',
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      costUsd: 0,
    }
  },
}

ensureLibrary()
const db = openDatabase()
const { app, processor } = createApp(db, { provider: fake })
const json = (body: unknown, method = 'POST') => ({ method, body: JSON.stringify(body) })
const get = async <T>(path: string) => (await (await app.request(path)).json()) as T
const patch = (id: string, body: unknown) => app.request(`/api/posts/${id}`, json(body, 'PATCH'))
const detail = (id: string) => get<PostDetail>(`/api/posts/${id}`)
const aiRuns = () => (db.prepare('SELECT count(*) AS n FROM ai_runs').get() as { n: number }).n

async function upload(name: string, args: string[], contentType: string) {
  const file = join(library.root, `post-workflow-${name}`)
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', ...args, file])
  const res = await app.request('/api/assets/upload', {
    method: 'POST',
    body: new Uint8Array(readFileSync(file)),
    headers: { 'Content-Type': contentType, 'X-File-Name': name },
  })
  return ((await res.json()) as CaptureResult).asset
}

// Colours/sizes unused by other test files (uploads are deduplicated by checksum).
const image = (name: string, color: string) =>
  upload(name, ['-i', `color=c=${color}:s=150x110`, '-frames:v', '1'], 'image/png')

async function newProject(name: string, isClientWork = false) {
  const res = await app.request('/api/projects', json({ name, isClientWork }))
  return (await res.json()) as Project
}

async function blank(body: Record<string, unknown>) {
  const res = await app.request('/api/posts', json(body))
  expect(res.status).toBe(201)
  return ((await res.json()) as { postIds: string[] }).postIds
}

let imgs: Asset[] = []
let clip: Asset

beforeAll(async () => {
  imgs = await Promise.all(
    ['orange', 'purple', 'yellow', 'cyan', 'magenta'].map((c) => image(`${c}.png`, c))
  )
  clip = await upload(
    'clip.mp4',
    ['-i', 'testsrc=duration=1:size=176x144:rate=12', '-pix_fmt', 'yuv420p'],
    'video/mp4'
  )
  await processor.idle()
})

describe('new draft from scratch', () => {
  it('creates a blank draft per platform without the AI', async () => {
    const before = aiRuns()
    const [x, story, feed] = await blank({ platforms: ['x', 'ig_story', 'ig_feed'] })
    expect(aiRuns()).toBe(before)

    const post = await detail(x!)
    expect(post).toMatchObject({ status: 'draft', platform: 'x', format: 'single', ideaId: null })
    expect(post.current?.segments).toEqual([{ text: '' }])
    expect(post.current?.author).toBe('me')
    expect((await detail(story!)).current?.segments).toEqual([
      { text: '', assetId: null, kind: 'text' },
    ])
    expect((await detail(feed!)).current?.caption).toBe('')
  })

  it('joins an idea’s package and takes its project', async () => {
    const project = await newProject('Workflow idea project')
    db.prepare(
      `INSERT INTO ideas (id, title, origin, project_id, angle) VALUES ('wf-idea', 'Hand idea', 'manual', ?, 'technical')`
    ).run(project.id)
    const ids = await blank({ platforms: ['x', 'linkedin'], ideaId: 'wf-idea' })
    const post = await detail(ids[0]!)
    expect(post).toMatchObject({ ideaId: 'wf-idea', projectId: project.id, angle: 'technical' })
    expect(post.siblings.map((s) => s.platform)).toEqual(['x', 'linkedin'])
    expect(db.prepare("SELECT status FROM ideas WHERE id = 'wf-idea'").get()).toEqual({
      status: 'drafted',
    })

    // An explicit "no project" wins over the idea's.
    const [loose] = await blank({ platforms: ['x'], ideaId: 'wf-idea', projectId: null })
    expect((await detail(loose!)).projectId).toBeNull()
  })

  it('refuses unknown ideas, projects and platforms', async () => {
    expect(
      (await app.request('/api/posts', json({ platforms: ['x'], ideaId: 'nope' }))).status
    ).toBe(400)
    expect(
      (await app.request('/api/posts', json({ platforms: ['x'], projectId: 'nope' }))).status
    ).toBe(400)
    expect((await app.request('/api/posts', json({ platforms: ['myspace'] }))).status).toBe(400)
    expect((await app.request('/api/posts', json({ platforms: [] }))).status).toBe(400)
  })
})

describe('log a published post', () => {
  it('needs an explicit OK before private media becomes public', async () => {
    const body = {
      platform: 'x',
      text: 'Posted from my phone',
      publicUrl: 'https://x.com/mario/status/42',
      publishedAt: '2026-09-20T08:15:00.000Z',
      assetIds: [imgs[0]!.id],
    }
    const blocked = await app.request('/api/posts/log', json(body))
    expect(blocked.status).toBe(409)
    expect(((await blocked.json()) as { assetIds: string[] }).assetIds).toEqual([imgs[0]!.id])
    expect(
      db.prepare('SELECT count(*) AS n FROM posts WHERE public_url = ?').get(body.publicUrl)
    ).toEqual({ n: 0 })

    const res = await app.request('/api/posts/log', json({ ...body, approveMedia: true }))
    expect(res.status).toBe(201)
    const post = (await res.json()) as PostDetail
    expect(post).toMatchObject({
      status: 'published',
      publishedAt: body.publishedAt,
      publicUrl: body.publicUrl,
      mediaAssetIds: [imgs[0]!.id],
      plannedFor: null,
    })
    expect(post.current?.segments).toEqual([{ text: 'Posted from my phone' }])
    const asset = await get<Asset>(`/api/assets/${imgs[0]!.id}`)
    expect(asset.visibility).toBe('approved')
    // It shows with the published posts (calendar / history).
    const published = await get<Post[]>('/api/posts?status=published')
    expect(published.some((p) => p.id === post.id)).toBe(true)
  })

  it('turns Instagram media into frames and the carousel text into its caption', async () => {
    const res = await app.request(
      '/api/posts/log',
      json({
        platform: 'ig_feed',
        text: 'Carousel caption',
        publishedAt: '2026-09-21T18:00:00.000Z',
        assetIds: [imgs[1]!.id, clip.id],
        approveMedia: true,
      })
    )
    expect(res.status).toBe(201)
    const post = (await res.json()) as PostDetail
    expect(post.format).toBe('carousel')
    expect(post.current?.caption).toBe('Carousel caption')
    expect(post.current?.segments).toEqual([
      { text: '', assetId: imgs[1]!.id, kind: 'image', assetIds: [imgs[1]!.id] },
      { text: '', assetId: clip.id, kind: 'video', assetIds: [clip.id] },
    ])
  })

  it('validates the platform rules and the input', async () => {
    const base = { platform: 'x', text: 'hi', publishedAt: '2026-09-21T18:00:00.000Z' }
    const status = async (body: unknown) => (await app.request('/api/posts/log', json(body))).status
    expect(await status({ ...base, assetIds: [imgs[2]!.id, clip.id], approveMedia: true })).toBe(
      400
    )
    expect(await status({ ...base, text: '  ' })).toBe(400)
    expect(await status({ ...base, publishedAt: 'yesterday' })).toBe(400)
    expect(await status({ ...base, publicUrl: 'javascript:alert(1)' })).toBe(400)
    const note = (
      (await (
        await app.request('/api/assets/note', json({ body: 'Not media' }))
      ).json()) as CaptureResult
    ).asset
    expect(await status({ ...base, assetIds: [note.id] })).toBe(400)
  })
})

describe('attached media (X / LinkedIn)', () => {
  const put = (id: string, assetIds: string[]) =>
    app.request(`/api/posts/${id}/media`, json({ assetIds }, 'PUT'))

  it('adds, reorders and removes media in order', async () => {
    const [id] = await blank({ platforms: ['x'] })
    const a = imgs[2]!.id
    const b = imgs[3]!.id
    expect(((await (await put(id!, [a, b])).json()) as PostDetail).mediaAssetIds).toEqual([a, b])
    expect(((await (await put(id!, [b, a])).json()) as PostDetail).mediaAssetIds).toEqual([b, a])
    expect(((await (await put(id!, [a])).json()) as PostDetail).mediaAssetIds).toEqual([a])
    // Idea-less posts use their media as sources.
    expect((await detail(id!)).sourceAssetIds).toEqual([a])
    expect(((await (await put(id!, [])).json()) as PostDetail).mediaAssetIds).toEqual([])
  })

  it('keeps each platform’s limits and refuses Instagram posts', async () => {
    const [x, linkedin, story] = await blank({ platforms: ['x', 'linkedin', 'ig_story'] })
    const five = imgs.map((i) => i.id)
    expect((await put(x!, five)).status).toBe(400)
    expect((await put(linkedin!, five)).status).toBe(200)
    expect((await put(x!, [clip.id, imgs[0]!.id])).status).toBe(400)
    expect((await put(x!, [clip.id])).status).toBe(200)
    expect((await put(story!, [imgs[0]!.id])).status).toBe(400)
    expect((await put('missing', [])).status).toBe(404)
  })

  it('keeps private media off approved posts', async () => {
    const [id] = await blank({ platforms: ['linkedin'] })
    const privateImg = await image('private-green.png', 'darkgreen')
    await processor.idle()
    expect(privateImg.visibility).toBe('private')
    // A draft may carry private media (it's approved before the post is).
    expect((await put(id!, [privateImg.id])).status).toBe(200)
    expect((await patch(id!, { status: 'approved' })).status).toBe(409)
    await put(id!, [])
    expect((await patch(id!, { status: 'approved' })).status).toBe(200)
    const res = await put(id!, [privateImg.id])
    expect(res.status).toBe(409)
    expect(((await res.json()) as { assetIds: string[] }).assetIds).toEqual([privateImg.id])
  })
})

describe('status workflow', () => {
  it('schedules and publishes only after approval', async () => {
    const [id] = await blank({ platforms: ['x'] })
    const when = '2026-10-05T08:00:00.000Z'
    const early = await patch(id!, { status: 'scheduled', scheduledFor: when })
    expect(early.status).toBe(409)
    expect(((await early.json()) as { error: string }).error).toMatch(/Approve this post/)
    expect((await patch(id!, { status: 'published' })).status).toBe(409)
    await patch(id!, { status: 'review' })
    expect((await patch(id!, { status: 'published' })).status).toBe(409)

    await patch(id!, { status: 'approved' })
    expect((await patch(id!, { status: 'scheduled', scheduledFor: when })).status).toBe(200)
    // Back to approved (not via "unschedule"): the slot is given up.
    const back = (await (await patch(id!, { status: 'approved' })).json()) as PostDetail
    expect(back).toMatchObject({ status: 'approved', scheduledFor: null })
    expect((await patch(id!, { status: 'published' })).status).toBe(200)
  })

  it('restores a discarded draft in one step and archives posts', async () => {
    const [id] = await blank({ platforms: ['linkedin'] })
    await patch(id!, { status: 'discarded' })
    expect(((await (await patch(id!, { status: 'draft' })).json()) as PostDetail).status).toBe(
      'draft'
    )

    await patch(id!, { status: 'archived' })
    const open = await get<Post[]>('/api/posts')
    expect(open.some((p) => p.id === id)).toBe(false)
    const archived = await get<Post[]>('/api/posts?status=archived')
    expect(archived.some((p) => p.id === id)).toBe(true)
    // Never published: it can't jump to published from the archive.
    expect((await patch(id!, { status: 'published' })).status).toBe(409)
    expect((await patch(id!, { status: 'draft' })).status).toBe(200)
  })

  it('unarchives a post that went out back to published', async () => {
    const res = await app.request(
      '/api/posts/log',
      json({ platform: 'linkedin', text: 'Old news', publishedAt: '2026-08-01T09:00:00.000Z' })
    )
    const { id } = (await res.json()) as PostDetail
    await patch(id, { status: 'archived' })
    const back = (await (await patch(id, { status: 'published' })).json()) as PostDetail
    expect(back).toMatchObject({ status: 'published', publishedAt: '2026-08-01T09:00:00.000Z' })
  })
})

describe('planning', () => {
  it('pencils drafts and approved posts onto a day without scheduling them', async () => {
    const [id] = await blank({ platforms: ['x'] })
    const planned = (await (await patch(id!, { plannedFor: '2026-10-07' })).json()) as PostDetail
    expect(planned).toMatchObject({ status: 'draft', plannedFor: '2026-10-07', scheduledFor: null })
    const listed = await get<Post[]>('/api/posts?status=draft')
    expect(listed.find((p) => p.id === id)?.plannedFor).toBe('2026-10-07')

    await patch(id!, { status: 'approved' })
    expect((await detail(id!)).plannedFor).toBe('2026-10-07')
    // Scheduling replaces the plan.
    const scheduled = (await (
      await patch(id!, { status: 'scheduled', scheduledFor: '2026-10-07T10:00:00.000Z' })
    ).json()) as PostDetail
    expect(scheduled).toMatchObject({ status: 'scheduled', plannedFor: null })
    expect((await patch(id!, { plannedFor: '2026-10-08' })).status).toBe(409)
  })

  it('clears a plan and rejects bad dates and archived posts', async () => {
    const [id] = await blank({ platforms: ['linkedin'] })
    await patch(id!, { plannedFor: '2026-10-09' })
    expect(
      ((await (await patch(id!, { plannedFor: null })).json()) as PostDetail).plannedFor
    ).toBeNull()
    expect((await patch(id!, { plannedFor: '2026-10-09T10:00:00Z' })).status).toBe(400)
    expect((await patch(id!, { plannedFor: 'next week' })).status).toBe(400)
    await patch(id!, { status: 'archived' })
    expect((await patch(id!, { plannedFor: '2026-10-09' })).status).toBe(409)
  })
})

describe('claims', () => {
  it('lets hand edits check off “confirm before posting” claims one by one', async () => {
    const [id] = await blank({ platforms: ['x'] })
    const claims = [
      { text: 'Built in a week', basis: 'unconfirmed', assetId: null },
      { text: 'Runs at 60 fps', basis: 'source', assetId: null },
      { text: 'First of its kind', basis: 'unconfirmed', assetId: null },
    ]
    // An AI revision with claims (written directly — no provider involved).
    db.prepare(
      `INSERT INTO post_revisions (id, post_id, segments, author, claims) VALUES (?, ?, '[{"text":"AI text"}]', 'ai', ?)`
    ).run(`${id}-ai`, id, JSON.stringify(claims))
    db.prepare('UPDATE posts SET current_revision_id = ? WHERE id = ?').run(`${id}-ai`, id)

    const save = async (body: Record<string, unknown>) =>
      (await (
        await app.request(
          `/api/posts/${id}/revisions`,
          json({ segments: [{ text: 'Edited' }], ...body })
        )
      ).json()) as PostDetail

    const checked = await save({ confirmedClaims: [0, 1] })
    expect(checked.current?.author).toBe('me')
    expect(checked.current?.claims).toEqual([
      { ...claims[0], confirmed: true },
      claims[1], // not an 'unconfirmed' claim: nothing to check off
      claims[2],
    ])
    // A later edit that doesn't mention claims keeps the check-offs.
    expect((await save({})).current?.claims[0]).toMatchObject({ confirmed: true })
    // Unchecking works too.
    expect((await save({ confirmedClaims: [2] })).current?.claims).toEqual([
      claims[0],
      claims[1],
      { ...claims[2], confirmed: true },
    ])
    expect(
      (
        await app.request(
          `/api/posts/${id}/revisions`,
          json({ segments: [{ text: 'x' }], confirmedClaims: [-1] })
        )
      ).status
    ).toBe(400)
  })
})

describe('projects', () => {
  it('sets a draft’s project, and refuses unknown ones', async () => {
    const project = await newProject('Picker project')
    const [id] = await blank({ platforms: ['x'] })
    expect(
      ((await (await patch(id!, { projectId: project.id })).json()) as PostDetail).projectId
    ).toBe(project.id)
    expect((await patch(id!, { projectId: 'nope' })).status).toBe(400)
    expect(
      ((await (await patch(id!, { projectId: null })).json()) as PostDetail).projectId
    ).toBeNull()
  })

  it('a post without a project picks one up when its source asset is assigned', async () => {
    const project = await newProject('Adopting project')
    const other = await newProject('Other project')
    const source = await image('source-khaki.png', 'khaki')
    const attached = await image('attached-navy.png', 'navy')
    await processor.idle()

    // From an idea: the idea's sources count.
    db.prepare("INSERT INTO ideas (id, title, origin) VALUES ('wf-adopt', 'Adopt', 'manual')").run()
    db.prepare("INSERT INTO idea_sources (idea_id, asset_id) VALUES ('wf-adopt', ?)").run(source.id)
    const [fromIdea] = await blank({ platforms: ['x'], ideaId: 'wf-adopt' })
    // Without an idea: its media count.
    const [loose] = await blank({ platforms: ['linkedin'] })
    await app.request(`/api/posts/${loose}/media`, json({ assetIds: [attached.id] }, 'PUT'))
    // Already in a project: left alone.
    const [kept] = await blank({ platforms: ['x'], ideaId: 'wf-adopt', projectId: other.id })

    const assign = (assetId: string) =>
      app.request(`/api/assets/${assetId}`, json({ projectId: project.id }, 'PATCH'))
    expect((await assign(source.id)).status).toBe(200)
    expect((await detail(fromIdea!)).projectId).toBe(project.id)
    expect((await detail(kept!)).projectId).toBe(other.id)
    expect((await detail(loose!)).projectId).toBeNull()

    await assign(attached.id)
    expect((await detail(loose!)).projectId).toBe(project.id)
  })

  it('never sends a post in a no-AI project to the provider', async () => {
    const client = await newProject('Confidential client', true)
    expect(client.aiAllowed).toBe(false)
    const [id] = await blank({ platforms: ['x'], projectId: client.id })
    const before = calls.length
    const res = await app.request(`/api/posts/${id}/revise`, json({ instruction: 'Shorter' }))
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: string }).error).toMatch(/Confidential client/)
    expect(calls.length).toBe(before)

    // Control: the same post without the project reaches the (fake) provider.
    await patch(id!, { projectId: null })
    const ok = await app.request(`/api/posts/${id}/revise`, json({ instruction: 'Shorter' }))
    expect(ok.status).toBe(200)
    expect(calls.length).toBe(before + 1)
  })
})

describe('migration 005', () => {
  it('adds planned_for and gives project-less posts their source’s project', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pullup-migrate-005-'))
    const path = join(dir, 'pullup.db')
    const old = openDatabase(path, { until: '004_renders.sql' })
    const profile = (
      old.prepare("SELECT id FROM profiles WHERE slug = 'mario'").get() as { id: string }
    ).id
    old.prepare("INSERT INTO projects (id, name, slug) VALUES ('p1', 'P1', 'p1')").run()
    old
      .prepare(
        `INSERT INTO assets (id, kind, source, captured_at, project_id, body)
       VALUES ('a1', 'note', 'note', '2026-09-01T00:00:00Z', 'p1', 'hi')`
      )
      .run()
    old.prepare("INSERT INTO ideas (id, title, origin) VALUES ('i1', 'T', 'manual')").run()
    old.prepare("INSERT INTO idea_sources (idea_id, asset_id) VALUES ('i1', 'a1')").run()
    old
      .prepare(
        `INSERT INTO posts (id, idea_id, profile_id, platform, format) VALUES ('post-1', 'i1', ?, 'x', 'single')`
      )
      .run(profile)
    old
      .prepare(
        `INSERT INTO posts (id, profile_id, platform, format) VALUES ('post-2', ?, 'x', 'single')`
      )
      .run(profile)
    old.close()

    const migrated = openDatabase(path)
    expect(
      migrated.prepare('SELECT id, project_id, planned_for FROM posts ORDER BY id').all()
    ).toEqual([
      { id: 'post-1', project_id: 'p1', planned_for: null },
      { id: 'post-2', project_id: null, planned_for: null },
    ])
    expect(migrated.pragma('foreign_key_check')).toEqual([])
    migrated.close()
  })
})
