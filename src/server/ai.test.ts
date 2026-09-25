import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { config } from './config.ts'
import type {
  AiKeyStatus,
  Asset,
  CaptureResult,
  Idea,
  PostDetail,
  Project,
  SystemInfo,
} from '@shared/types.ts'
import { ensureLibrary, library } from './library.ts'
import { openDatabase } from './db/index.ts'
import { createApp } from './app.ts'
import type { AiProvider, AiRequest } from './ai/provider.ts'

// A provider that records requests and returns canned output per task.
const calls: AiRequest<unknown>[] = []
let assetId = ''

const outputs: Record<string, () => unknown> = {
  'analyze one captured asset': () => ({
    description: 'A generative mycelium simulation behind a hero headline.',
    subjects: ['mycelium simulation', 'hero section'],
    suggestedTags: ['webgl', 'generative'],
    suggestedProjectId: 'not-a-real-id',
    hooks: ['The growth reacts to the cursor.'],
    questions: ['Is this WebGL or canvas 2D?'],
  }),
  'suggest post ideas': () => ({
    ideas: [
      {
        title: 'How the mycelium grows',
        summary: 'Walk through the growth rules.',
        angle: 'technical',
        format: 'thread',
        platforms: ['x'],
        rationale: 'The recording shows the growth step by step.',
        sourceAssetIds: [assetId],
        questions: [],
      },
      {
        title: 'Why nature sims on client sites',
        summary: 'Business value of calm motion.',
        angle: 'business',
        format: 'single',
        platforms: ['x', 'ig_feed'],
        rationale: 'Mario notes it was built for a client hero.',
        sourceAssetIds: ['hallucinated-id'],
        questions: ['Can the client be named?'],
      },
    ],
  }),
  'write drafts for several platforms': () => ({
    x: {
      format: 'single',
      segments: [
        {
          text: 'Mycelium sim for a hero: the trail follows the cursor.',
          assetId: null,
          kind: null,
        },
      ],
      caption: null,
      claims: [
        { text: 'trail follows the cursor', basis: 'source', assetId },
        { text: 'runs at 60fps', basis: 'unconfirmed', assetId: 'bogus' },
      ],
      questions: ['What is the particle count?'],
    },
    linkedin: {
      format: 'single',
      segments: [
        {
          text: 'For a recent hero section I built a mycelium simulation.\n\nIt grows along the cursor.',
          assetId: assetId,
          kind: 'video',
        },
      ],
      caption: 'ignored for LinkedIn',
      claims: [],
      questions: [],
    },
    ig_story: {
      format: 'story_seq',
      segments: [
        { text: 'New hero experiment', assetId: null, kind: 'text' },
        { text: 'It grows where you move', assetId, kind: 'video' },
        { text: 'Invented frame', assetId: 'hallucinated-id', kind: 'image' },
      ],
      caption: 'stories have no caption',
      claims: [],
      questions: [],
    },
    ig_feed: {
      format: 'carousel',
      segments: [
        { text: 'Mycelium hero', assetId, kind: 'video' },
        { text: '', assetId: null, kind: 'text' },
      ],
      caption: 'A calm, generative hero for a data company.',
      claims: [],
      questions: [],
    },
  }),
  'revise a draft': () => ({
    format: 'single',
    segments: [{ text: 'Shorter: mycelium that follows your cursor.', assetId: null, kind: null }],
    caption: null,
    claims: [{ text: 'follows your cursor', basis: 'source', assetId }],
    questions: [],
  }),
}

const fake: AiProvider = {
  name: 'fake',
  model: 'fake-model',
  async generate<T>(request: AiRequest<T>) {
    calls.push(request as AiRequest<unknown>)
    const key = Object.keys(outputs).find((k) => request.system.includes(k))
    if (!key) throw new Error('unknown task')
    return {
      output: request.schema.parse(outputs[key]!()),
      model: 'fake-model',
      usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 },
      costUsd: 0.01,
    }
  },
}

ensureLibrary()
const db = openDatabase()
const { app, processor } = createApp(db, { provider: fake })
const offline = createApp(db).app // no API key configured in tests

const json = (body: unknown, method = 'POST') => ({ method, body: JSON.stringify(body) })
const get = async <T>(path: string) => (await (await app.request(path)).json()) as T

beforeAll(async () => {
  const video = join(library.root, 'ai-fixture.mov')
  execFileSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=duration=6:size=1280x720:rate=24',
    '-pix_fmt',
    'yuv420p',
    video,
  ])
  const bytes = readFileSync(video)
  const res = await app.request('/api/assets/upload', {
    method: 'POST',
    body: new Uint8Array(bytes),
    headers: { 'Content-Type': 'video/quicktime', 'X-File-Name': 'mycelium.mov' },
  })
  assetId = ((await res.json()) as CaptureResult).asset.id
  await processor.idle()
  await app.request(
    `/api/assets/${assetId}`,
    json({ notes: 'Hero uses the mycelium sim with a mouse trail.' }, 'PATCH')
  )
})

describe('ai', () => {
  it('explains how to enable AI when no key is set', async () => {
    const res = await offline.request(`/api/assets/${assetId}/analyze`, { method: 'POST' })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { error: string }).error).toMatch(/API key in Settings/)
  })

  it('analyzes an asset from its frames and Mario’s notes', async () => {
    const res = await app.request(`/api/assets/${assetId}/analyze`, { method: 'POST' })
    expect(res.status).toBe(200)
    const asset = (await res.json()) as Asset
    expect(asset.analysis).toMatchObject({
      description: expect.stringContaining('mycelium'),
      questions: ['Is this WebGL or canvas 2D?'],
      suggestedProjectId: null, // invented ids are dropped
    })

    const request = calls.at(-1)!
    const images = request.content.filter((c) => c.type === 'image')
    expect(images).toHaveLength(6)
    const text = request.content.find((c) => c.type === 'text')
    expect(text && 'text' in text && text.text).toContain(
      'Notes (by Mario): Hero uses the mycelium sim'
    )
    expect(request.effort).toBe('low')

    const run = db
      .prepare("SELECT * FROM ai_runs WHERE task = 'analyze-asset' AND error IS NULL")
      .get() as {
      prompt_version: string
      cost_usd: number
    }
    expect(run).toMatchObject({ prompt_version: 'analyze-asset@v1', cost_usd: 0.01 })
  })

  let ideas: Idea[] = []

  it('generates ideas that cite only real sources', async () => {
    const res = await app.request('/api/ideas/generate', json({ assetIds: [assetId] }))
    expect(res.status).toBe(201)
    ideas = (await res.json()) as Idea[]
    expect(ideas).toHaveLength(2)
    for (const idea of ideas) expect(idea.sources.map((s) => s.assetId)).toEqual([assetId])
    expect(ideas.find((i) => i.angle === 'business')?.questions).toEqual([
      'Can the client be named?',
    ])
  })

  let draftId = ''

  it('drafts one idea for X, LinkedIn and an Instagram story by default', async () => {
    const profile = await get<{ id: string; slug: string }>('/api/profiles/current')
    expect(profile.slug).toBe('mario')
    const idea = ideas.find((i) => i.angle === 'technical')!
    // No profile or platforms needed: written as Mario for X, LinkedIn and an IG story.
    const res = await app.request(`/api/ideas/${idea.id}/draft`, json({}))
    expect(res.status).toBe(201)
    const { postIds } = (await res.json()) as { postIds: string[] }
    expect(postIds).toHaveLength(3)
    draftId = postIds[0]!

    const x = await get<PostDetail>(`/api/posts/${draftId}`)
    expect(x).toMatchObject({
      platform: 'x',
      format: 'single',
      status: 'draft',
      profileId: profile.id,
    })
    expect(x.mediaAssetIds).toEqual([assetId])
    expect(x.sourceAssetIds).toEqual([assetId])
    expect(x.siblings.map((s) => s.platform)).toEqual(['x', 'linkedin', 'ig_story'])
    // Citations of unknown assets are cleared rather than trusted.
    expect(x.current?.claims.map((c) => c.assetId)).toEqual([assetId, null])
    expect(x.current?.segments[0]).toEqual({ text: expect.stringContaining('Mycelium') })

    const linkedin = await get<PostDetail>(`/api/posts/${postIds[1]}`)
    expect(linkedin).toMatchObject({
      platform: 'linkedin',
      format: 'single',
      mediaAssetIds: [assetId],
    })
    expect(linkedin.current?.caption).toBeNull()
    expect(linkedin.current?.segments[0]).not.toHaveProperty('assetId')

    const story = await get<PostDetail>(`/api/posts/${postIds[2]}`)
    expect(story).toMatchObject({ platform: 'ig_story', format: 'story_seq' })
    expect(story.current?.caption).toBeNull()
    expect(story.current?.segments).toEqual([
      { text: 'New hero experiment', assetId: null, kind: 'text' },
      { text: 'It grows where you move', assetId, kind: 'video' },
      // An asset the AI made up becomes a text frame.
      { text: 'Invented frame', assetId: null, kind: 'text' },
    ])
    expect(story.mediaAssetIds).toEqual([assetId])

    // The request carried only the requested platforms' rules.
    const text = calls.at(-1)!.content.find((c) => c.type === 'text')
    const prompt = text && 'text' in text ? text.text : ''
    expect(prompt).toContain('<platform id="linkedin">')
    expect(prompt).toContain('<platform id="ig_story">')
    expect(prompt).not.toContain('<platform id="ig_feed">')

    const [updated] = (await (await app.request('/api/ideas?status=drafted')).json()) as Idea[]
    expect(updated?.id).toBe(idea.id)
  })

  it('writes an Instagram carousel with a caption and Mario’s platform notes', async () => {
    const notes = 'Always end the caption with the project year.'
    await app.request(
      '/api/profiles/current',
      json({ platformStyles: { ig_feed: notes } }, 'PATCH')
    )
    const idea = ideas.find((i) => i.angle === 'business')!
    const res = await app.request(`/api/ideas/${idea.id}/draft`, json({ platforms: ['ig_feed'] }))
    const { postIds } = (await res.json()) as { postIds: string[] }
    expect(postIds).toHaveLength(1)
    const carousel = await get<PostDetail>(`/api/posts/${postIds[0]}`)
    expect(carousel).toMatchObject({ platform: 'ig_feed', format: 'carousel' })
    expect(carousel.current?.caption).toBe('A calm, generative hero for a data company.')

    const text = calls.at(-1)!.content.find((c) => c.type === 'text')
    expect(text && 'text' in text && text.text).toContain(notes)

    // Manual edits: a frame pointing at a non-visual asset becomes a text slide.
    const note = (await (
      await app.request('/api/assets/note', json({ body: 'Not an image' }))
    ).json()) as CaptureResult
    const saved = (await (
      await app.request(
        `/api/posts/${postIds[0]}/revisions`,
        json({
          segments: [
            { text: 'Cover', assetId, kind: 'video' },
            { text: 'Oops', assetId: note.asset.id, kind: 'image' },
          ],
          caption: 'Edited caption',
        })
      )
    ).json()) as PostDetail
    expect(saved.current?.segments[1]).toEqual({ text: 'Oops', assetId: null, kind: 'text' })
    expect(saved.current?.caption).toBe('Edited caption')
    expect(saved.format).toBe('carousel')
  })

  it('keeps manual edits and AI revisions as history', async () => {
    await app.request(
      `/api/posts/${draftId}/revisions`,
      json({ segments: [{ text: 'My own first line.' }, { text: 'And a second post.' }] })
    )
    let post = await get<PostDetail>(`/api/posts/${draftId}`)
    expect(post).toMatchObject({ format: 'thread', current: { author: 'me' } })

    const res = await app.request(`/api/posts/${draftId}/revise`, json({ instruction: 'shorter' }))
    post = (await res.json()) as PostDetail
    expect(post.current).toMatchObject({ author: 'ai', instruction: 'shorter' })
    expect(post.revisions).toHaveLength(3)
    const lastText = calls.at(-1)!.content.find((c) => c.type === 'text')
    expect(lastText && 'text' in lastText && lastText.text).toContain('[1] My own first line.')

    const original = post.revisions.at(-1)!
    post = (await (
      await app.request(`/api/posts/${draftId}/restore/${original.id}`, { method: 'POST' })
    ).json()) as PostDetail
    expect(post.current?.id).toBe(original.id)
    expect(post.format).toBe('single')
  })

  it('uses the writing voice from Settings in every request', async () => {
    const voice = 'Short sentences. Never say "excited". Mention the tools used.'
    const res = await app.request('/api/profiles/current', json({ voiceGuide: voice }, 'PATCH'))
    expect(res.status).toBe(200)
    await app.request('/api/ideas/generate', json({ assetIds: [assetId] }))
    const text = calls.at(-1)!.content.find((c) => c.type === 'text')
    expect(text && 'text' in text && text.text).toContain(voice)

    const empty = await app.request('/api/profiles/current', json({ voiceGuide: '  ' }, 'PATCH'))
    expect(empty.status).toBe(400)
  })

  it('never sends assets of a project with AI turned off', async () => {
    const project = (await (
      await app.request('/api/projects', json({ name: 'Secret Client', isClientWork: true }))
    ).json()) as Project
    await app.request(`/api/assets/${assetId}`, json({ projectId: project.id }, 'PATCH'))

    const before = calls.length
    const res = await app.request(`/api/assets/${assetId}/analyze`, { method: 'POST' })
    expect(res.status).toBe(403)
    expect(calls.length).toBe(before)
  })
})

describe('api key settings', () => {
  const verified: string[] = []
  const keyed = createApp(db, {
    providerFactory: () => fake,
    verifyKey: async (key) => {
      verified.push(key)
      if (key.includes('bad')) {
        const { AiError } = await import('./ai/provider.ts')
        throw new AiError('Anthropic rejected this key.', 400)
      }
    },
  }).app
  const put = (apiKey: string) =>
    keyed.request('/api/settings/ai-key', { method: 'PUT', body: JSON.stringify({ apiKey }) })
  const good = 'sk-ant-api03-' + 'A'.repeat(40) + 'wxyz'

  it('rejects malformed and unverified keys without writing them', async () => {
    expect((await put('not-a-key')).status).toBe(400)
    expect(verified).toEqual([])
    const res = await put('sk-ant-bad-' + 'x'.repeat(30))
    expect(res.status).toBe(400)
    expect(existsSync(config.envFile) ? readFileSync(config.envFile, 'utf8') : '').not.toContain(
      'bad'
    )
  })

  it('saves a verified key to .env, enables AI and only ever returns a hint', async () => {
    const res = await put(`  ${good}\n`)
    expect(res.status).toBe(200)
    const status = (await res.json()) as AiKeyStatus
    expect(status).toEqual({ configured: true, source: 'env-file', hint: 'sk-ant-…wxyz' })

    expect(readFileSync(config.envFile, 'utf8')).toContain(`ANTHROPIC_API_KEY=${good}\n`)
    expect(statSync(config.envFile).mode & 0o777).toBe(0o600)

    const system = (await (await keyed.request('/api/system')).json()) as SystemInfo
    expect(system.ai.enabled).toBe(true)
    expect(JSON.stringify(system)).not.toContain(good)
    expect(
      JSON.stringify(await (await keyed.request('/api/settings/ai-key')).json())
    ).not.toContain(good)
  })

  it('removes the key', async () => {
    const res = await keyed.request('/api/settings/ai-key', { method: 'DELETE' })
    expect(((await res.json()) as AiKeyStatus).configured).toBe(false)
    expect(readFileSync(config.envFile, 'utf8')).not.toContain('ANTHROPIC_API_KEY')
    const system = (await (await keyed.request('/api/system')).json()) as SystemInfo
    expect(system.ai.enabled).toBe(false)
  })

  it('blocks requests from other websites', async () => {
    const evil = await keyed.request('/api/settings/ai-key', {
      method: 'PUT',
      headers: { Origin: 'https://evil.example' },
      body: JSON.stringify({ apiKey: good }),
    })
    expect(evil.status).toBe(403)

    const otherLocalApp = await keyed.request('/api/assets/note', {
      method: 'POST',
      headers: { Origin: 'http://localhost:4321' },
      body: JSON.stringify({ body: 'x' }),
    })
    expect(otherLocalApp.status).toBe(403)

    const noOriginCrossSite = await keyed.request('/api/assets/note', {
      method: 'POST',
      headers: { 'Sec-Fetch-Site': 'cross-site' },
      body: JSON.stringify({ body: 'x' }),
    })
    expect(noOriginCrossSite.status).toBe(403)

    const rebinding = await keyed.request('/api/system', { headers: { Host: 'evil.example:4500' } })
    expect(rebinding.status).toBe(403)

    // Reads too: another local dev server can't fetch Pullup's data.
    const crossRead = await keyed.request('/api/assets', {
      headers: { Origin: 'http://localhost:4321' },
    })
    expect(crossRead.status).toBe(403)

    const sameApp = await keyed.request('/api/assets/note', {
      method: 'POST',
      headers: {
        Origin: `http://localhost:${config.publicPort}`,
        Host: `localhost:${config.publicPort}`,
      },
      body: JSON.stringify({ body: 'from Pullup itself' }),
    })
    expect(sameApp.status).toBe(201)
  })
})
