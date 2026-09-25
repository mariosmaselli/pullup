import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ANGLES } from '@shared/constants.ts'
import type { AiDeps } from '../../index.ts'
import { loadPrompt } from '../../prompts.ts'
import { runAi } from '../../run.ts'
import { AiError } from '../../provider.ts'

const prompt = loadPrompt('draft-post', 'v1')

export const ClaimSchema = z.object({
  text: z.string(),
  basis: z.enum(['source', 'framing', 'unconfirmed']),
  assetId: z.string().nullable(),
})

const Output = z.object({
  drafts: z.array(
    z.object({
      angle: z.enum(ANGLES),
      format: z.enum(['single', 'thread']),
      segments: z.array(z.object({ text: z.string() })),
      claims: z.array(ClaimSchema),
      questions: z.array(z.string()),
    })
  ),
})

interface IdeaRow {
  id: string
  title: string
  summary: string
  angle: string | null
  format: string | null
  rationale: string
  questions: string
  profile_id: string | null
  project_id: string | null
}

// X allows up to 4 images or 1 video per post.
function pickMedia(rows: { id: string; kind: string }[]): string[] {
  const video = rows.find((r) => r.kind === 'video')
  if (video) return [video.id]
  return rows
    .filter((r) => r.kind === 'image')
    .slice(0, 4)
    .map((r) => r.id)
}

export async function draftPost(
  deps: AiDeps,
  input: { ideaId: string; profileId: string; instruction?: string }
): Promise<string[]> {
  const { db, provider, context, assets } = deps
  const idea = db.prepare('SELECT * FROM ideas WHERE id = ?').get(input.ideaId) as
    IdeaRow | undefined
  if (!idea) throw new AiError('Idea not found', 400)
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(input.profileId) as
    { id: string; name: string; voice_guide: string } | undefined
  if (!profile) throw new AiError('Profile not found', 400)

  const sourceIds = (
    db.prepare('SELECT asset_id FROM idea_sources WHERE idea_id = ?').all(idea.id) as {
      asset_id: string
    }[]
  ).map((r) => r.asset_id)
  const rows = assets.rows(sourceIds)
  const sources = await context.sources(rows)

  const result = await runAi(
    db,
    provider,
    {
      task: 'draft-post',
      promptVersion: prompt.version,
      inputRefs: { ideaId: idea.id, profileId: profile.id, platform: 'x', assetIds: sourceIds },
    },
    {
      system: prompt.system,
      effort: 'high',
      schema: Output,
      content: [
        {
          type: 'text',
          text: [
            `Posting as: ${profile.name}. ${profile.voice_guide}`,
            context.describeProject(idea.project_id),
            [
              `<idea angle="${idea.angle ?? 'any'}" format="${idea.format ?? 'any'}">`,
              `Title: ${idea.title}`,
              `Summary: ${idea.summary}`,
              `Why: ${idea.rationale}`,
              '</idea>',
            ].join('\n'),
            input.instruction && `Mario's direction: ${input.instruction}`,
            `The material:\n${sources.text}`,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
        ...sources.images,
      ],
    }
  )

  const media = pickMedia(rows)
  const validIds = new Set(sourceIds)
  const ids: string[] = []
  db.transaction(() => {
    for (const draft of result.output.drafts) {
      const postId = randomUUID()
      const revisionId = randomUUID()
      db.prepare(
        `INSERT INTO posts (id, idea_id, profile_id, project_id, platform, format, angle, status)
         VALUES (?, ?, ?, ?, 'x', ?, ?, 'draft')`
      ).run(postId, idea.id, profile.id, idea.project_id, draft.format, draft.angle)
      db.prepare(
        `INSERT INTO post_revisions (id, post_id, segments, author, claims, questions, ai_run_id)
         VALUES (?, ?, ?, 'ai', ?, ?, ?)`
      ).run(
        revisionId,
        postId,
        JSON.stringify(draft.segments),
        JSON.stringify(
          draft.claims.map((c) => ({
            ...c,
            assetId: c.assetId && validIds.has(c.assetId) ? c.assetId : null,
          }))
        ),
        JSON.stringify(draft.questions),
        result.runId
      )
      db.prepare('UPDATE posts SET current_revision_id = ? WHERE id = ?').run(revisionId, postId)
      media.forEach((assetId, position) =>
        db
          .prepare(
            'INSERT INTO post_media (post_id, asset_id, segment_index, position) VALUES (?, ?, 0, ?)'
          )
          .run(postId, assetId, position)
      )
      ids.push(postId)
    }
    db.prepare("UPDATE ideas SET status = 'drafted', updated_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      idea.id
    )
  })()
  deps.notify()
  return ids
}
