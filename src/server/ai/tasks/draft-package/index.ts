import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Platform } from '@shared/constants.ts'
import type { AiDeps } from '../../index.ts'
import { loadPrompt, platformRules } from '../../prompts.ts'
import { runAi } from '../../run.ts'
import { AiError } from '../../provider.ts'
import { DraftSchema, type DraftOutput } from '../../schemas.ts'
import { writingProfile } from '../../../services/profiles.ts'
import { parseQuestions } from '../../../services/ideas.ts'
import {
  cleanSegments,
  formatFor,
  setAttachedMedia,
  writeRevision,
} from '../../../services/posts.ts'
import type { AssetRow } from '../../../services/assets.ts'

const prompt = loadPrompt('draft-package', 'v2')

export const Output = z.object({
  x: DraftSchema.nullable(),
  linkedin: DraftSchema.nullable(),
  ig_story: DraftSchema.nullable(),
  ig_feed: DraftSchema.nullable(),
})

export const DEFAULT_PLATFORMS: Platform[] = ['x', 'linkedin', 'ig_story']

interface IdeaRow {
  id: string
  title: string
  summary: string
  angle: string | null
  format: string | null
  rationale: string
  questions: string
  origin: 'discovery' | 'manual' | 'asset'
  project_id: string | null
}

// Media attached to a whole post: X takes 1 video or up to 4 images; LinkedIn 1 video or up to 9.
function attachedMedia(platform: Platform, rows: AssetRow[]): string[] {
  const video = rows.find((r) => r.kind === 'video')
  if (video) return [video.id]
  const images = rows.filter((r) => r.kind === 'image')
  return images.slice(0, platform === 'x' ? 4 : 9).map((r) => r.id)
}

export interface DraftPackageInput {
  ideaId: string
  platforms?: Platform[]
  profileId?: string | null
  instruction?: string
}

// One idea → one draft per platform (X, LinkedIn, Instagram story, Instagram carousel).
export async function draftPackage(
  deps: AiDeps,
  input: DraftPackageInput
): Promise<{ postIds: string[]; skipped: Platform[] }> {
  const { db, provider, context, assets } = deps
  const platforms = [...new Set(input.platforms?.length ? input.platforms : DEFAULT_PLATFORMS)]
  const idea = db.prepare('SELECT * FROM ideas WHERE id = ?').get(input.ideaId) as
    IdeaRow | undefined
  if (!idea) throw new AiError('Idea not found', 400)
  // An idea without sources still carries its project's details: that project must allow AI too.
  context.assertProjectAllowed(idea.project_id)
  const profile = writingProfile(db, input.profileId)
  const styles = JSON.parse(profile.platform_prefs).styles ?? {}

  const sourceIds = (
    db
      .prepare('SELECT asset_id FROM idea_sources WHERE idea_id = ? ORDER BY rowid')
      .all(idea.id) as {
      asset_id: string
    }[]
  ).map((r) => r.asset_id)
  const rows = assets.rows(sourceIds)
  const sources = await context.sources(rows)
  // The idea's project plus any its sources were assigned to since.
  const projectIds = [
    ...new Set(
      [idea.project_id, ...rows.map((r) => r.project_id)].filter((id): id is string => !!id)
    ),
  ]
  // Mario's own words: his answers to the idea's questions, and posts in his voice.
  const answered = parseQuestions(idea.questions).filter((q) => q.answer)
  const voice = context.voiceExamples(platforms, idea.id)

  const result = await runAi(
    db,
    provider,
    {
      task: 'draft-package',
      promptVersion: prompt.version,
      inputRefs: {
        ideaId: idea.id,
        profileId: profile.id,
        platforms,
        assetIds: sourceIds,
        instruction: input.instruction || undefined,
        answers: answered.length,
        voiceExamples: voice.postIds,
      },
    },
    {
      system: prompt.system,
      effort: 'high',
      schema: Output,
      maxTokens: 24000,
      content: [
        {
          type: 'text',
          text: [
            `Posting as: ${profile.name}. ${profile.voice_guide}`,
            ...projectIds.map((id) => context.describeProject(id)),
            [
              `<idea angle="${idea.angle ?? 'any'}" format="${idea.format ?? 'any'}"${idea.origin === 'manual' ? ' by="mario"' : ''}>`,
              `Title: ${idea.title}`,
              idea.summary && `Summary: ${idea.summary}`,
              idea.rationale && `Why: ${idea.rationale}`,
              '</idea>',
            ]
              .filter(Boolean)
              .join('\n'),
            answered.length &&
              [
                '<answers by="mario">',
                ...answered.map((q) => `Q: ${q.question}\nA: ${q.answer}`),
                '</answers>',
              ].join('\n'),
            `Requested platforms: ${platforms.join(', ')}.`,
            platformRules(platforms, styles),
            voice.text,
            input.instruction && `Mario's direction: ${input.instruction}`,
            `The material:\n${sources.text || '(none — write from the idea and Mario’s answers only)'}`,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
        ...sources.images,
      ],
    }
  )

  const allowed = new Set(sourceIds)
  const ids: string[] = []
  const skipped: Platform[] = []
  db.transaction(() => {
    for (const platform of platforms) {
      const draft: DraftOutput | null = result.output[platform]
      if (!draft || !draft.segments.length) {
        skipped.push(platform)
        continue
      }
      const segments = cleanSegments(db, platform, draft.segments, allowed)
      const postId = randomUUID()
      db.prepare(
        `INSERT INTO posts (id, idea_id, profile_id, project_id, platform, format, angle, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')`
      ).run(
        postId,
        idea.id,
        profile.id,
        idea.project_id ?? projectIds[0] ?? null,
        platform,
        formatFor(platform, segments.length),
        idea.angle
      )
      writeRevision(db, {
        postId,
        platform,
        segments,
        caption: draft.caption,
        author: 'ai',
        claims: draft.claims.map((c) => ({
          ...c,
          assetId: c.assetId && allowed.has(c.assetId) ? c.assetId : null,
        })),
        questions: draft.questions,
        aiRunId: result.runId,
      })
      if (platform === 'x' || platform === 'linkedin') {
        setAttachedMedia(db, postId, attachedMedia(platform, rows))
      }
      ids.push(postId)
    }
    if (!ids.length) throw new AiError('The AI returned no drafts — try again.', 502)
    db.prepare("UPDATE ideas SET status = 'drafted', updated_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      idea.id
    )
  })()
  deps.notify()
  return { postIds: ids, skipped }
}
