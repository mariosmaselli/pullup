import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { AiDeps } from '../../index.ts'
import { loadPrompt } from '../../prompts.ts'
import { runAi } from '../../run.ts'
import { AiError } from '../../provider.ts'
import { ClaimSchema } from '../draft-post/index.ts'

const prompt = loadPrompt('revise-post', 'v1')

const Output = z.object({
  format: z.enum(['single', 'thread']),
  segments: z.array(z.object({ text: z.string() })),
  claims: z.array(ClaimSchema),
  questions: z.array(z.string()),
})

interface PostRow {
  id: string
  idea_id: string | null
  profile_id: string
  project_id: string | null
  angle: string | null
  format: string
  current_revision_id: string | null
}

export async function revisePost(
  deps: AiDeps,
  input: { postId: string; instruction: string }
): Promise<string> {
  const { db, provider, context, assets } = deps
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(input.postId) as
    PostRow | undefined
  if (!post) throw new AiError('Post not found', 400)
  const current = db
    .prepare('SELECT segments FROM post_revisions WHERE id = ?')
    .get(post.current_revision_id) as { segments: string } | undefined
  const profile = db
    .prepare('SELECT name, voice_guide FROM profiles WHERE id = ?')
    .get(post.profile_id) as {
    name: string
    voice_guide: string
  }

  const sourceIds = post.idea_id
    ? (
        db.prepare('SELECT asset_id FROM idea_sources WHERE idea_id = ?').all(post.idea_id) as {
          asset_id: string
        }[]
      ).map((r) => r.asset_id)
    : (
        db.prepare('SELECT asset_id FROM post_media WHERE post_id = ?').all(post.id) as {
          asset_id: string
        }[]
      ).map((r) => r.asset_id)
  const sources = await context.sources(assets.rows(sourceIds))
  const segments = current ? (JSON.parse(current.segments) as { text: string }[]) : []

  const result = await runAi(
    db,
    provider,
    {
      task: 'revise-post',
      promptVersion: prompt.version,
      inputRefs: {
        postId: post.id,
        revisionId: post.current_revision_id,
        instruction: input.instruction,
      },
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
            context.describeProject(post.project_id),
            `Current draft (angle: ${post.angle ?? 'any'}, format: ${post.format}):\n${segments
              .map((s, i) => `[${i + 1}] ${s.text}`)
              .join('\n')}`,
            `Instruction: ${input.instruction}`,
            `The material:\n${sources.text}`,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
        ...sources.images,
      ],
    }
  )

  const validIds = new Set(sourceIds)
  const revisionId = randomUUID()
  db.transaction(() => {
    db.prepare(
      `INSERT INTO post_revisions (id, post_id, segments, author, instruction, claims, questions, ai_run_id)
       VALUES (?, ?, ?, 'ai', ?, ?, ?, ?)`
    ).run(
      revisionId,
      post.id,
      JSON.stringify(result.output.segments),
      input.instruction,
      JSON.stringify(
        result.output.claims.map((c) => ({
          ...c,
          assetId: c.assetId && validIds.has(c.assetId) ? c.assetId : null,
        }))
      ),
      JSON.stringify(result.output.questions),
      result.runId
    )
    db.prepare(
      'UPDATE posts SET current_revision_id = ?, format = ?, updated_at = ? WHERE id = ?'
    ).run(revisionId, result.output.format, new Date().toISOString(), post.id)
  })()
  deps.notify()
  return revisionId
}
