import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { extractFrame, ffmpegVersion, probe, sipsSize, sipsToJpeg } from '../lib/ffmpeg.ts'
import { downloadImage, fetchLinkMeta } from '../lib/link-meta.ts'
import { fromLibraryPath, library, toLibraryPath } from '../library.ts'
import type { AssetRow, AssetStore, DerivativeRow } from './assets.ts'

const THUMB_WIDTH = 720
const FRAME_WIDTH = 1280 // frames are what AI analysis reads (M3)
const FRAME_COUNT = 6
const CONCURRENCY = 2

type NewDerivative = Omit<DerivativeRow, 'asset_id' | 'created_at'>

// Background queue that extracts metadata and builds derivatives into cache/<asset id>/.
export function createProcessor(assets: AssetStore) {
  const queue: string[] = []
  const idle: (() => void)[] = []
  let running = 0

  const pump = () => {
    while (running < CONCURRENCY && queue.length) {
      const id = queue.shift()!
      running++
      process(id).finally(() => {
        running--
        pump()
      })
    }
    if (running === 0 && !queue.length) idle.splice(0).forEach((resolve) => resolve())
  }

  async function process(id: string) {
    const row = assets.row(id)
    if (!row) return
    assets.update(id, { processing_status: 'processing', processing_error: null })

    const dir = join(library.cache, id)
    try {
      await rm(dir, { recursive: true, force: true })
      await mkdir(dir, { recursive: true })

      if (row.kind === 'image') await processImage(row, dir)
      else if (row.kind === 'video') await processVideo(row, dir)
      else if (row.kind === 'link') await processLink(row, dir)

      assets.update(id, { processing_status: 'ready' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[processing] ${id} failed: ${message}`)
      assets.update(id, { processing_status: 'failed', processing_error: message.slice(0, 500) })
    }
  }

  const derivative = (
    role: NewDerivative['role'],
    path: string,
    size: { width: number | null; height: number | null },
    timeMs: number | null = null
  ): NewDerivative => ({
    id: randomUUID(),
    role,
    file_path: toLibraryPath(path),
    width: size.width,
    height: size.height,
    time_ms: timeMs,
  })

  const scaled = (width: number | null, height: number | null, max: number) => {
    if (!width || !height || width <= max) return { width, height }
    return { width: max, height: Math.round((height / width) * max) }
  }

  async function processImage(row: AssetRow, dir: string) {
    const input = fromLibraryPath(row.file_path!)
    const thumb = join(dir, 'thumb.jpg')

    // SVG renders natively in the browser; nothing to extract.
    if (row.mime === 'image/svg+xml') return

    // HEIC/HEIF go through macOS sips: ffmpeg decodes only one 512px tile of the image grid.
    const heif = /image\/hei[cf]/.test(row.mime ?? '')
    let size: { width: number | null; height: number | null }
    if (heif) {
      size = (await sipsSize(input)) ?? { width: null, height: null }
      await sipsToJpeg(input, thumb, THUMB_WIDTH, size.width)
    } else {
      size = await probe(input)
      await extractFrame(input, thumb, null, THUMB_WIDTH)
    }

    const derivatives = [derivative('thumb', thumb, scaled(size.width, size.height, THUMB_WIDTH))]

    // Browsers can't display HEIC/HEIF: add a large JPEG preview for the detail view (and AI).
    if (heif) {
      const poster = join(dir, 'poster.jpg')
      await sipsToJpeg(input, poster, FRAME_WIDTH, size.width)
      derivatives.push(derivative('poster', poster, scaled(size.width, size.height, FRAME_WIDTH)))
    }

    assets.update(row.id, { width: size.width, height: size.height })
    assets.replaceDerivatives(row.id, derivatives)
  }

  async function processVideo(row: AssetRow, dir: string) {
    if (!ffmpegVersion()) throw new Error('ffmpeg is not installed — brew install ffmpeg')
    const input = fromLibraryPath(row.file_path!)
    const meta = await probe(input)
    assets.update(row.id, { width: meta.width, height: meta.height, duration_ms: meta.durationMs })

    const duration = meta.durationMs ?? 0
    const derivatives: NewDerivative[] = []

    // Evenly spaced frames, skipping the very start and end (often blank in screen recordings).
    const count = duration < 3000 ? 1 : FRAME_COUNT
    const times = Array.from({ length: count }, (_, i) =>
      Math.round((duration * (i + 1)) / (count + 1))
    )
    for (const [i, time] of times.entries()) {
      const path = join(dir, `frame-${i + 1}.jpg`)
      await extractFrame(input, path, time, FRAME_WIDTH)
      derivatives.push(
        derivative('frame', path, scaled(meta.width, meta.height, FRAME_WIDTH), time)
      )
    }

    const posterTime = times[0] ?? 0
    const poster = join(dir, 'poster.jpg')
    const thumb = join(dir, 'thumb.jpg')
    await extractFrame(input, poster, posterTime, FRAME_WIDTH)
    await extractFrame(input, thumb, posterTime, THUMB_WIDTH)
    derivatives.push(
      derivative('poster', poster, scaled(meta.width, meta.height, FRAME_WIDTH), posterTime),
      derivative('thumb', thumb, scaled(meta.width, meta.height, THUMB_WIDTH), posterTime)
    )

    assets.replaceDerivatives(row.id, derivatives)
  }

  async function processLink(row: AssetRow, dir: string) {
    const meta = await fetchLinkMeta(row.url!)
    assets.update(row.id, { url_meta: JSON.stringify(meta) })
    if (!meta.image) return assets.replaceDerivatives(row.id, [])

    // Preview images are optional — a link without one is still a valid capture.
    const image = await downloadImage(meta.image).catch(() => null)
    if (!image) return assets.replaceDerivatives(row.id, [])

    const original = join(dir, `og.${image.ext}`)
    const thumb = join(dir, 'thumb.jpg')
    await writeFile(original, image.bytes)
    try {
      const size = await probe(original)
      await extractFrame(original, thumb, null, THUMB_WIDTH)
      assets.replaceDerivatives(row.id, [
        derivative('og_image', original, size),
        derivative('thumb', thumb, scaled(size.width, size.height, THUMB_WIDTH)),
      ])
    } catch {
      assets.replaceDerivatives(row.id, [
        derivative('og_image', original, { width: null, height: null }),
      ])
    }
  }

  return {
    enqueue(id: string) {
      if (!queue.includes(id)) queue.push(id)
      pump()
    },

    // Re-queues work interrupted by a restart.
    resume() {
      for (const id of assets.idsWithStatus(['pending', 'processing'])) this.enqueue(id)
    },

    // Resolves once the queue is empty (used by tests).
    idle(): Promise<void> {
      if (running === 0 && !queue.length) return Promise.resolve()
      return new Promise((resolve) => idle.push(resolve))
    },
  }
}

export type Processor = ReturnType<typeof createProcessor>
