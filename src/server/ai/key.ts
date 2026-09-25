import Anthropic from '@anthropic-ai/sdk'
import type { AiKeyStatus } from '@shared/types.ts'
import { config } from '../config.ts'
import { setEnvValue } from '../lib/env-file.ts'
import { AiError } from './provider.ts'

export type KeyVerifier = (apiKey: string) => Promise<void>

// Checks a key against the Models API — no tokens are spent.
export const verifyWithAnthropic: KeyVerifier = async (apiKey) => {
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 15_000 })
  try {
    await client.models.retrieve('claude-opus-5')
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new AiError('Anthropic rejected this key. Check that it was copied completely.', 400)
    }
    if (err instanceof Anthropic.PermissionDeniedError) {
      throw new AiError('This key is valid but not allowed to use the API.', 400)
    }
    if (err instanceof Anthropic.NotFoundError) {
      throw new AiError('This key works, but Claude Opus 5 is not available on its account.', 400)
    }
    if (err instanceof Anthropic.APIConnectionError) {
      throw new AiError('Could not reach Anthropic to check the key. Are you online?', 502)
    }
    if (err instanceof Anthropic.APIError) {
      throw new AiError(
        `Anthropic couldn’t check the key right now (${err.status ?? 'error'}). Try again in a moment.`,
        502
      )
    }
    throw err
  }
}

const KEY_FORMAT = /^sk-ant-[A-Za-z0-9_-]{20,}$/

// Owns the current Anthropic key: where it came from, saving it to .env, removing it.
// The full key never leaves this module except to the provider.
export function createKeyManager(options: {
  verify: KeyVerifier
  onChange: (apiKey: string) => void
}) {
  let key = config.anthropicApiKey
  let source = config.anthropicKeySource

  return {
    get key() {
      return key
    },

    status(): AiKeyStatus {
      return {
        configured: !!key,
        source,
        hint: key ? `${key.slice(0, 7)}…${key.slice(-4)}` : null,
      }
    },

    async set(input: string) {
      const apiKey = input.trim()
      if (source === 'environment') {
        throw new AiError('The key is set in your shell environment; change it there.', 400)
      }
      if (!KEY_FORMAT.test(apiKey)) {
        throw new AiError(
          'That doesn’t look like an Anthropic API key (it starts with sk-ant-).',
          400
        )
      }
      await options.verify(apiKey)
      await setEnvValue(config.envFile, 'ANTHROPIC_API_KEY', apiKey)
      key = apiKey
      source = 'env-file'
      options.onChange(key)
    },

    async clear() {
      if (source === 'environment') {
        throw new AiError('The key is set in your shell environment; remove it there.', 400)
      }
      await setEnvValue(config.envFile, 'ANTHROPIC_API_KEY', null)
      key = ''
      source = null
      options.onChange(key)
    },
  }
}

export type KeyManager = ReturnType<typeof createKeyManager>
