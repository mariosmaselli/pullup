import { z } from 'zod'
import { SEGMENT_KINDS } from '@shared/constants.ts'

// Output shapes shared by the drafting tasks.

export const ClaimSchema = z.object({
  text: z.string(),
  basis: z.enum(['source', 'framing', 'unconfirmed']),
  assetId: z.string().nullable(),
})

export const SegmentSchema = z.object({
  text: z.string(),
  assetId: z.string().nullable(),
  kind: z.enum(SEGMENT_KINDS).nullable(),
})

export const DraftSchema = z.object({
  format: z.enum(['single', 'thread', 'story_seq', 'carousel']),
  segments: z.array(SegmentSchema),
  caption: z.string().nullable(),
  claims: z.array(ClaimSchema),
  questions: z.array(z.string()),
})

export type DraftOutput = z.infer<typeof DraftSchema>
