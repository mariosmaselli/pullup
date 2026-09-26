import { ALL_FORMATS, Input, UrlSource, VideoSampleSink, type InputVideoTrack } from 'mediabunny'
import type { MediaInput, VideoLayer } from '@shared/template.ts'

// Enough pixels for any crop of a 1080×1920 output (a landscape image filling a 9:16 story
// needs ~1920 px of height), bounded so a handful of images fit in GPU memory. Same rule as the
// video proxies (server/lib/ffmpeg.ts proxySize), with a little more room on the long side.
const MAX_SHORT_SIDE = 2160
const MAX_LONG_SIDE = 4096

// Upright (EXIF applied), colour-managed bitmap, scaled down to MAX_SHORT/LONG_SIDE.
export async function loadImage(url: string, signal?: AbortSignal): Promise<ImageBitmap> {
  const blob = await (await fetch(url, { signal })).blob()
  const full = await createImageBitmap(blob, {
    imageOrientation: 'from-image',
    colorSpaceConversion: 'default',
  })
  const factor = Math.min(
    1,
    MAX_SHORT_SIDE / Math.min(full.width, full.height),
    MAX_LONG_SIDE / Math.max(full.width, full.height)
  )
  if (factor === 1) return full
  const resized = await createImageBitmap(full, {
    resizeWidth: Math.round(full.width * factor),
    resizeHeight: Math.round(full.height * factor),
    resizeQuality: 'high',
  })
  full.close()
  return resized
}

// An opened video (its proxy): one demuxer and sample sink, shared by the layers that read it.
// Every getSample() runs its own decoder, so layers of different sessions don't interfere.
export interface VideoSource {
  sink: VideoSampleSink
  duration: number
  width: number
  height: number
  dispose(): void
}

export async function openVideo(url: string): Promise<VideoSource> {
  const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS })
  try {
    const track = (await input.getPrimaryVideoTrack()) as InputVideoTrack | null
    if (!track) throw new Error('Video has no video track')
    return {
      sink: new VideoSampleSink(track),
      duration: await track.computeDuration(),
      width: track.displayWidth,
      height: track.displayHeight,
      dispose: () => input.dispose(),
    }
  } catch (err) {
    input.dispose()
    throw err
  }
}

// Preview only: decoded images and opened videos, kept by URL between the sessions of one preview
// worker, so changing a setting re-runs the template's setup() without fetching and decoding its
// media again. Exports never use it (each runs in a fresh worker and opens its media itself).
export class MediaCache {
  private images = new Map<string, Promise<ImageBitmap>>()
  private videos = new Map<string, Promise<VideoSource>>()

  // A copy the session owns: templates and sessions close their bitmaps, the cache keeps its own.
  async image(url: string): Promise<ImageBitmap> {
    let loading = this.images.get(url)
    if (!loading) {
      loading = loadImage(url)
      this.images.set(url, loading)
      loading.catch(() => this.images.get(url) === loading && this.images.delete(url))
    }
    return createImageBitmap(await loading)
  }

  video(url: string): Promise<VideoSource> {
    let opening = this.videos.get(url)
    if (!opening) {
      opening = openVideo(url)
      this.videos.set(url, opening)
      opening.catch(() => this.videos.get(url) === opening && this.videos.delete(url))
    }
    return opening
  }

  // Frees everything the given URLs don't use (call when no session is being set up).
  keep(urls: Iterable<string>) {
    const wanted = new Set(urls)
    for (const [url, loading] of this.images) {
      if (wanted.has(url)) continue
      this.images.delete(url)
      loading.then((b) => b.close()).catch(() => {})
    }
    for (const [url, opening] of this.videos) {
      if (wanted.has(url)) continue
      this.videos.delete(url)
      opening.then((v) => v.dispose()).catch(() => {})
    }
  }
}

// A video input decoded frame-accurately with Mediabunny (WebCodecs) from its render proxy.
export class VideoLayerImpl implements VideoLayer {
  duration: number
  width: number
  height: number
  frame: VideoFrame | null = null
  version = 0

  private video: VideoSource | null = null
  private requested: number | null = null
  private shown: number | null = null
  private pending: Promise<void> | null = null
  private schedule: AsyncGenerator<unknown> | null = null
  private scheduleTimes: (number | null)[] = []
  private disposed = false

  // With a cache, the opened video is shared (and outlives this layer); without, the layer owns it.
  constructor(
    readonly source: MediaInput,
    private cache?: MediaCache
  ) {
    this.duration = source.duration ?? 0
    this.width = source.width
    this.height = source.height
  }

  async init() {
    this.video = this.cache
      ? await this.cache.video(this.source.url)
      : await openVideo(this.source.url)
    this.duration = this.video.duration
    this.width = this.video.width
    this.height = this.video.height
  }

  seek(localTime: number) {
    this.requested = Math.min(Math.max(0, localTime), Math.max(0, this.duration - 1 / 120))
  }

  // Collected during the export dry run.
  takeRequest(): number | null {
    const t = this.requested
    this.requested = null
    return t
  }

  private setFrame(frame: VideoFrame) {
    // A decode can finish after the layer was disposed (its session replaced mid-seek).
    if (this.disposed) return frame.close()
    this.frame?.close()
    this.frame = frame
    this.version++
  }

  // Preview: start from the frame another layer of the same video shows (the session this one
  // replaces), so a setting change never flashes an empty video.
  adopt(other: VideoLayerImpl) {
    if (other.source.url !== this.source.url || !other.frame) return
    this.setFrame(other.frame.clone())
    this.shown = other.shown
  }

  // Preview: never waits. Starts decoding the latest request and shows it when ready.
  resolvePreview() {
    const t = this.requested
    this.requested = null
    if (t === null || t === this.shown || this.pending || !this.video) return
    this.shown = t
    this.pending = this.video.sink
      .getSample(t)
      .then((sample) => {
        if (!sample) return
        this.setFrame(sample.toVideoFrame())
        sample.close()
      })
      .catch(() => {})
      .finally(() => {
        this.pending = null
      })
  }

  // Preview, before a session is first shown: wait for a frame only if there is none at all.
  // The request stays for resolvePreview() when the layer already shows something.
  async resolveFirst() {
    if (this.frame || this.requested === null) return
    await this.resolveExact()
  }

  // Export: exact frame, awaited. Used for stills (a single seek).
  async resolveExact() {
    const t = this.requested
    this.requested = null
    if (t === null || !this.video) return
    const sample = await this.video.sink.getSample(t)
    if (sample) {
      this.setFrame(sample.toVideoFrame())
      this.shown = t
      sample.close()
    }
  }

  // Export: the dry run produced one requested time (or null = keep) per output frame.
  // Consecutive identical times are held rather than decoded again.
  startSchedule(times: (number | null)[]) {
    let last: number | null = null
    this.scheduleTimes = times.map((t) => {
      if (t === null || t === last) return null
      last = t
      return t
    })
    const wanted = this.scheduleTimes.filter((t): t is number => t !== null)
    this.schedule = wanted.length && this.video ? this.video.sink.samplesAtTimestamps(wanted) : null
  }

  async resolveScheduled(frame: number) {
    if (this.scheduleTimes[frame] === null || this.scheduleTimes[frame] === undefined) return
    const next = await this.schedule?.next()
    const sample = next?.value as { toVideoFrame(): VideoFrame; close(): void } | null | undefined
    if (sample) {
      this.setFrame(sample.toVideoFrame())
      sample.close()
    }
  }

  dispose() {
    this.disposed = true
    this.frame?.close()
    this.frame = null
    void this.schedule?.return(undefined)
    if (!this.cache) this.video?.dispose()
  }
}
