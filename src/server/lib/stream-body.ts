import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import type { ReadableStream } from 'node:stream/web'
import { pipeline } from 'node:stream/promises'

export class BodyTooLargeError extends Error {}

// Streams a raw request body to a file (never buffering it in memory), hashing it on the way.
export async function streamBodyToFile(
  body: globalThis.ReadableStream<Uint8Array>,
  path: string,
  maxBytes: number
): Promise<{ size: number; sha256: string }> {
  const hash = createHash('sha256')
  let size = 0
  await pipeline(
    Readable.fromWeb(body as ReadableStream),
    async function* (source) {
      for await (const chunk of source as AsyncIterable<Buffer>) {
        size += chunk.length
        if (size > maxBytes) throw new BodyTooLargeError(`Upload is larger than ${maxBytes} bytes`)
        hash.update(chunk)
        yield chunk
      }
    },
    createWriteStream(path)
  )
  return { size, sha256: hash.digest('hex') }
}
