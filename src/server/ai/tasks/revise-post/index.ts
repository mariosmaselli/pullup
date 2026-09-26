import type { Platform } from '@shared/constants.ts'
import type { Segment } from '@shared/types.ts'
import { carryOverFrames, frameAssetIds } from '@shared/frames.ts'
import type { AiDeps } from '../../index.ts'
import { loadPrompt, platformRules } from '../../prompts.ts'
import { runAi } from '../../run.ts'
import { AiError } from '../../provider.ts'
import { DraftSchema } from '../../schemas.ts'
import { cleanSegments, hasFrameMedia, writeRevision } from '../../../services/posts.ts'
import { writingProfile } from '../../../services/profiles.ts'

const prompt = loadPrompt('revise-post', 'v2')

interface PostRow {
  id: string
  idea_id: string | null
  profile_id: string
  project_id: string | null
  platform: Platform
  angle: string | null
  format: string
  current_revision_id: string | null
}

// Instagram frames list all their media; `asset=` is the first one (what the AI returns as
// `assetId` — the rest are carried over after the revision).
const describeMedia = (s: Segment) => {
  const [first, ...more] = frameAssetIds(s)
  if (!first) return ''
  return ` asset=${first}${more.length ? `; slideshow of ${more.length + 1}: ${[first, ...more].join(', ')}` : ''}`
}

const describeSegments = (platform: Platform, segments: Segment[]) =>
  segments
    .map((s, i) =>
      hasFrameMedia(platform)
        ? `[${i + 1}] (${s.kind ?? 'text'}${describeMedia(s)}) ${s.text}`
        : `[${i + 1}] ${s.text}`
    )
    .join('\n')

export async function revisePost(
  deps: AiDeps,
  input: { postId: string; instruction: string }
): Promise<string> {
  const { db, provider, context, assets } = deps
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(input.postId) as
    PostRow | undefined
  if (!post) throw new AiError('Post not found', 400)
  const current = db
    .prepare('SELECT segments, caption FROM post_revisions WHERE id = ?')
    .get(post.current_revision_id) as { segments: string; caption: string | null } | undefined
  const profile = writingProfile(db, post.profile_id)
  const styles = JSON.parse(profile.platform_prefs).styles ?? {}

  const sourceIds = post.idea_id
    ? (
        db
          .prepare('SELECT asset_id FROM idea_sources WHERE idea_id = ? ORDER BY rowid')
          .all(post.idea_id) as {
          asset_id: string
        }[]
      ).map((r) => r.asset_id)
    : [
        ...new Set(
          (
            db
              .prepare(
                'SELECT asset_id FROM post_media WHERE post_id = ? ORDER BY segment_index, position'
              )
              .all(post.id) as { asset_id: string }[]
          ).map((r) => r.asset_id)
        ),
      ]
  const sources = await context.sources(assets.rows(sourceIds))
  const segments = current ? (JSON.parse(current.segments) as Segment[]) : []

  const result = await runAi(
    db,
    provider,
    {
      task: 'revise-post',
      promptVersion: prompt.version,
      inputRefs: {
        postId: post.id,
        platform: post.platform,
        revisionId: post.current_revision_id,
        instruction: input.instruction,
      },
    },
    {
      system: prompt.system,
      effort: 'high',
      schema: DraftSchema,
      content: [
        {
          type: 'text',
          text: [
            `Posting as: ${profile.name}. ${profile.voice_guide}`,
            context.describeProject(post.project_id),
            platformRules([post.platform], styles),
            `Current draft (platform: ${post.platform}, angle: ${post.angle ?? 'any'}, format: ${post.format}):\n${describeSegments(post.platform, segments)}`,
            post.platform === 'ig_feed' &&
              current?.caption &&
              `Current caption:\n${current.caption}`,
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

  const allowed = new Set(sourceIds)
  // Frames keep media Mario picked himself (it may not be in the material).
  const frameMedia = new Set([...allowed, ...segments.flatMap(frameAssetIds)])
  const out = result.output
  const revisionId = db.transaction(() =>
    writeRevision(db, {
      postId: post.id,
      platform: post.platform,
      segments: cleanSegments(
        db,
        post.platform,
        hasFrameMedia(post.platform) ? carryOverFrames(segments, out.segments) : out.segments,
        frameMedia
      ),
      caption: out.caption,
      author: 'ai',
      instruction: input.instruction,
      claims: out.claims.map((c) => ({
        ...c,
        assetId: c.assetId && allowed.has(c.assetId) ? c.assetId : null,
      })),
      questions: out.questions,
      aiRunId: result.runId,
    })
  )()
  deps.notify()
  return revisionId
}
