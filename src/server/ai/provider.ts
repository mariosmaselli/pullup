import type { z } from 'zod'

// Provider-neutral request/response for one structured AI call. Swap providers by implementing
// AiProvider; tasks never import a vendor SDK.

export type AiContent =
  | { type: 'text'; text: string }
  | {
      type: 'image'
      mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
      data: string
    }

export type AiEffort = 'low' | 'medium' | 'high'

export interface AiRequest<T> {
  system: string
  content: AiContent[]
  schema: z.ZodType<T>
  effort: AiEffort
  maxTokens?: number
}

export interface AiUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export interface AiResult<T> {
  output: T
  model: string
  usage: AiUsage
  costUsd: number
}

export interface AiProvider {
  name: string
  model: string
  generate<T>(request: AiRequest<T>): Promise<AiResult<T>>
}

export class AiError extends Error {
  constructor(
    message: string,
    public status: 400 | 403 | 422 | 502 | 503 = 502
  ) {
    super(message)
  }
}
