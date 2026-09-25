import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, canEncodeVideo } from 'mediabunny'
import type { Session } from './session.ts'

export interface EncodeResult {
  buffer: ArrayBuffer
  mime: 'video/mp4' | 'image/jpeg'
  encoder: string
  elapsedMs: number
}

// Frame-stepped export: every frame is rendered at its exact time, then captured and encoded.
export async function encodeVideo(
  session: Session,
  canvas: OffscreenCanvas,
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal
): Promise<EncodeResult> {
  const started = performance.now()
  const { fps, frames } = session
  const bitrate = fps >= 60 ? 20e6 : 14e6
  // Mediabunny picks the H.264 level without looking at the frame rate; set it explicitly.
  const fullCodecString = fps >= 60 ? 'avc1.64002a' : 'avc1.640028'
  const size = { width: canvas.width, height: canvas.height, bitrate, frameRate: fps }
  const hardware = await canEncodeVideo('avc', {
    ...size,
    hardwareAcceleration: 'prefer-hardware',
    fullCodecString,
  })
  const acceleration = hardware ? 'prefer-hardware' : 'prefer-software'

  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget(),
  })
  const source = new CanvasSource(canvas, {
    codec: 'avc',
    bitrate,
    keyFrameInterval: 1,
    latencyMode: 'quality',
    hardwareAcceleration: acceleration,
    fullCodecString,
  })
  output.addVideoTrack(source, { frameRate: fps })
  await output.start()

  session.planVideo()
  for (let i = 0; i < frames; i++) {
    if (signal.aborted) {
      await output.cancel()
      throw new DOMException('Render cancelled', 'AbortError')
    }
    await session.frame(i / fps, i, 'scheduled')
    // Captured in the same task as render(): no preserveDrawingBuffer needed.
    await source.add(i / fps, 1 / fps)
    if (i % 5 === 0 || i === frames - 1) onProgress(i + 1, frames)
  }
  await output.finalize()

  return {
    buffer: output.target.buffer!,
    mime: 'video/mp4',
    encoder: `webcodecs avc ${fullCodecString} ${bitrate / 1e6}Mbps ${acceleration}`,
    elapsedMs: Math.round(performance.now() - started),
  }
}

export async function encodeStill(
  session: Session,
  canvas: OffscreenCanvas,
  at = 0
): Promise<EncodeResult> {
  const started = performance.now()
  await session.frame(at, Math.round(at * session.fps), 'exact')
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 })
  return {
    buffer: await blob.arrayBuffer(),
    mime: 'image/jpeg',
    encoder: 'canvas jpeg q0.92',
    elapsedMs: Math.round(performance.now() - started),
  }
}
