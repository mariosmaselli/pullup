import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import {
  AiError,
  type AiContent,
  type AiProvider,
  type AiRequest,
  type AiUsage,
} from '../provider.ts'

const MODEL = 'claude-opus-5'

// USD per million tokens (Claude Opus 5). Cache writes 1.25×, reads 0.1× of input.
const PRICE = { input: 5, output: 25 }

const cost = (u: AiUsage) =>
  (u.inputTokens * PRICE.input +
    u.cacheWriteTokens * PRICE.input * 1.25 +
    u.cacheReadTokens * PRICE.input * 0.1 +
    u.outputTokens * PRICE.output) /
  1_000_000

const toBlock = (c: AiContent): Anthropic.Beta.BetaContentBlockParam =>
  c.type === 'text'
    ? { type: 'text', text: c.text }
    : { type: 'image', source: { type: 'base64', media_type: c.mediaType, data: c.data } }

export function createAnthropicProvider(apiKey: string): AiProvider {
  const client = new Anthropic({ apiKey })

  return {
    name: 'anthropic',
    model: MODEL,

    async generate<T>({ system, content, schema, effort, maxTokens = 16000 }: AiRequest<T>) {
      try {
        const response = await client.beta.messages.parse({
          model: MODEL,
          max_tokens: maxTokens,
          // Declined requests are re-run on Anthropic's recommended fallback model.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          thinking: { type: 'adaptive' },
          output_config: { effort, format: betaZodOutputFormat(schema) },
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: content.map(toBlock) }],
        })

        if (response.stop_reason === 'refusal') {
          throw new AiError('The model declined this request.', 422)
        }
        if (response.stop_reason === 'max_tokens') {
          throw new AiError('The response was cut off (max tokens).', 502)
        }
        if (!response.parsed_output) throw new AiError('The response did not match the schema.')

        const usage: AiUsage = {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
        }
        return {
          output: response.parsed_output as T,
          model: response.model,
          usage,
          costUsd: cost(usage),
        }
      } catch (err) {
        if (err instanceof AiError) throw err
        if (err instanceof Anthropic.AuthenticationError) {
          throw new AiError(
            'The Anthropic API key was rejected — check ANTHROPIC_API_KEY in .env.',
            503
          )
        }
        if (err instanceof Anthropic.RateLimitError) {
          throw new AiError('Rate limited by the AI provider — try again in a moment.', 503)
        }
        if (err instanceof Anthropic.APIError) {
          throw new AiError(`AI provider error ${err.status ?? ''}: ${err.message}`.trim())
        }
        throw err
      }
    },
  }
}

// Used when no key is configured: every call explains how to enable AI.
export const unavailableProvider: AiProvider = {
  name: 'none',
  model: 'none',
  generate() {
    return Promise.reject(
      new AiError('AI is not set up yet — add ANTHROPIC_API_KEY to .env and restart Pullup.', 503)
    )
  },
}
