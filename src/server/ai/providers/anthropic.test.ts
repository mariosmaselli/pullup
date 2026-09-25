import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AiError } from '../provider.ts'
import { createAnthropicProvider } from './anthropic.ts'

// Runs the real provider + SDK streaming/parsing against a fake HTTP stream — no network, no key.

interface Sent {
  body: Record<string, unknown>
  headers: Headers
}

const sse = (events: object[]) =>
  events
    .map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`)
    .join('')

function fakeStream(text: string, stopReason = 'end_turn') {
  const sent: Sent[] = []
  const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    sent.push({ body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) })
    const body = sse([
      {
        type: 'message_start',
        message: {
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 1000,
            output_tokens: 1,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 2000,
          },
        },
      },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: { output_tokens: 400 },
      },
      { type: 'message_stop' },
    ])
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
  }
  return { fetch: fetch as typeof globalThis.fetch, sent }
}

// The first `failures` calls open a stream and then send `event: error` of `type`.
function failingMidStream(
  fake: ReturnType<typeof fakeStream>,
  failures: number,
  type = 'overloaded_error'
) {
  let calls = 0
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls++
    if (calls > failures) return fake.fetch(url, init)
    const error = { type: 'error', error: { type, message: 'Overloaded' } }
    const body = `event: message_start\ndata: ${JSON.stringify({
      type: 'message_start',
      message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5', content: [] },
    })}\n\nevent: error\ndata: ${JSON.stringify(error)}\n\n`
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
  }
  return { fetch: fetch as typeof globalThis.fetch, calls: () => calls }
}

const Schema = z.object({ answer: z.string() })
const request = (maxTokens: number) => ({
  system: 'test',
  content: [{ type: 'text' as const, text: 'hi' }],
  schema: Schema,
  effort: 'high' as const,
  maxTokens,
})

describe('anthropic provider', () => {
  it('streams large requests and parses the structured output', async () => {
    const fake = fakeStream('{"answer":"forty-two"}')
    const provider = createAnthropicProvider('sk-test', { fetch: fake.fetch, maxRetries: 0 })

    // 24k max tokens is what draft-package asks for; a non-streaming call refuses it.
    const result = await provider.generate(request(24000))

    expect(result.output).toEqual({ answer: 'forty-two' })
    expect(result.usage).toEqual({
      inputTokens: 1000,
      outputTokens: 400,
      cacheReadTokens: 2000,
      cacheWriteTokens: 0,
    })
    expect(result.costUsd).toBeCloseTo((1000 * 5 + 2000 * 0.5 + 400 * 25) / 1e6)

    expect(fake.sent).toHaveLength(1)
    const { body, headers } = fake.sent[0]!
    expect(body.stream).toBe(true)
    expect(body.max_tokens).toBe(24000)
    expect(body.output_config).toMatchObject({ effort: 'high', format: { type: 'json_schema' } })
    expect(headers.get('anthropic-beta')).toContain('structured-outputs-2025-12-15')
    expect(headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01')
  })

  it('turns a cut-off response into a readable AiError', async () => {
    const fake = fakeStream('{"answer":"forty', 'max_tokens')
    const provider = createAnthropicProvider('sk-test', { fetch: fake.fetch, maxRetries: 0 })
    const err = await provider.generate(request(24000)).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AiError)
    expect((err as AiError).message).toMatch(/cut off/)
  })

  it('turns a refusal into a 422', async () => {
    const fake = fakeStream('', 'refusal')
    const provider = createAnthropicProvider('sk-test', { fetch: fake.fetch, maxRetries: 0 })
    const err = await provider.generate(request(16000)).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AiError)
    expect((err as AiError).status).toBe(422)
  })

  it('rejects output that is not JSON or does not match the schema', async () => {
    for (const text of ['not json at all', '{"answer":42}']) {
      const fake = fakeStream(text)
      const provider = createAnthropicProvider('sk-test', { fetch: fake.fetch, maxRetries: 0 })
      const err = await provider.generate(request(16000)).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(AiError)
      expect((err as AiError).message).toMatch(/did not match the schema/)
    }
  })

  it('never leaks a raw SDK error (it would surface as "Internal error")', async () => {
    const fetch = (async () =>
      new Response('event: message_start\ndata: {"type":"message_start"', {
        headers: { 'content-type': 'text/event-stream' },
      })) as typeof globalThis.fetch
    const provider = createAnthropicProvider('sk-test', { fetch, maxRetries: 0 })
    const err = await provider.generate(request(16000)).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AiError)
  })

  it('retries once when the API is overloaded mid-stream', async () => {
    const flaky = failingMidStream(fakeStream('{"answer":"ok"}'), 1)
    const provider = createAnthropicProvider('sk-test', { fetch: flaky.fetch, retryDelayMs: 0 })
    const result = await provider.generate(request(24000))
    expect(result.output).toEqual({ answer: 'ok' })
    expect(flaky.calls()).toBe(2)
  })

  it('says "busy" (503, no raw JSON) when it stays overloaded', async () => {
    const flaky = failingMidStream(fakeStream('{"answer":"ok"}'), 5)
    const provider = createAnthropicProvider('sk-test', { fetch: flaky.fetch, retryDelayMs: 0 })
    const err = await provider.generate(request(24000)).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AiError)
    expect((err as AiError).status).toBe(503)
    expect((err as AiError).message).not.toContain('{')
    expect(flaky.calls()).toBe(2)
  })

  it('does not retry other mid-stream errors and shows their message', async () => {
    const flaky = failingMidStream(fakeStream('{"answer":"ok"}'), 5, 'invalid_request_error')
    const provider = createAnthropicProvider('sk-test', { fetch: flaky.fetch, retryDelayMs: 0 })
    const err = await provider.generate(request(24000)).catch((e: unknown) => e)
    expect((err as AiError).message).toBe('AI provider error: Overloaded')
    expect(flaky.calls()).toBe(1)
  })
})
