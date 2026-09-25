import { ALL_FORMATS, Input, UrlSource, VideoSampleSink, type InputVideoTrack } from 'mediabunny'
import type { MediaInput, VideoLayer } from '@shared/template.ts'

const MAX_IMAGE_SIDE = 2160 // 2× the 1080 design width

// Upright (EXIF applied), colour-managed bitmap, capped to 2160 px on the long side.
export async function loadImage(url: string, signal: AbortSignal): Promise<ImageBitmap> {
  const blob = await (await fetch(url, { signal })).blob()
  const full = await createImageBitmap(blob, {
    imageOrientation: 'from-image',
    colorSpaceConversion: 'default',
  })
  const long = Math.max(full.width, full.height)
  if (long <= MAX_IMAGE_SIDE) return full
  const factor = MAX_IMAGE_SIDE / long
  const resized = await createImageBitmap(full, {
    resizeWidth: Math.round(full.width * factor),
    resizeHeight: Math.round(full.height * factor),
    resizeQuality: 'high',
  })
  full.close()
  return resized
}

// A video input decoded frame-accurately with Mediabunny (WebCodecs) from its render proxy.
export class VideoLayerImpl implements VideoLayer {
  duration: number
  width: number
  height: number
  frame: VideoFrame | null = null
  version = 0

  private input: Input | null = null
  private sink: VideoSampleSink | null = null
  private requested: number | null = null
  private shown: number | null = null
  private pending: Promise<void> | null = null
  private schedule: AsyncGenerator<unknown> | null = null
  private scheduleTimes: (number | null)[] = []

  constructor(private source: MediaInput) {
    this.duration = source.duration ?? 0
    this.width = source.width
    this.height = source.height
  }

  async init() {
    this.input = new Input({ source: new UrlSource(this.source.url), formats: ALL_FORMATS })
    const track = (await this.input.getPrimaryVideoTrack()) as InputVideoTrack | null
    if (!track) throw new Error('Video has no video track')
    this.sink = new VideoSampleSink(track)
    this.duration = await track.computeDuration()
    this.width = track.displayWidth
    this.height = track.displayHeight
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
    this.frame?.close()
    this.frame = frame
    this.version++
  }

  // Preview: never waits. Starts decoding the latest request and shows it when ready.
  resolvePreview() {
    const t = this.requested
    this.requested = null
    if (t === null || t === this.shown || this.pending || !this.sink) return
    this.shown = t
    this.pending = this.sink
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

  // Export: exact frame, awaited. Used for stills (a single seek).
  async resolveExact() {
    const t = this.requested
    this.requested = null
    if (t === null || !this.sink) return
    const sample = await this.sink.getSample(t)
    if (sample) {
      this.setFrame(sample.toVideoFrame())
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
    this.schedule = wanted.length && this.sink ? this.sink.samplesAtTimestamps(wanted) : null
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
    this.frame?.close()
    this.frame = null
    void this.schedule?.return(undefined)
    this.input?.dispose()
  }
}
