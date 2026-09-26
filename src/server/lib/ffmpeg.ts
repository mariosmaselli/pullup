import { spawn, spawnSync } from 'node:child_process'

let cached: string | null | undefined

// Returns the ffmpeg version (e.g. "7.1.1"), or null when ffmpeg is not installed.
export function ffmpegVersion(): string | null {
  if (cached !== undefined) return cached
  const result = spawnSync('ffmpeg', ['-hide_banner', '-version'], { encoding: 'utf8' })
  cached =
    result.status === 0 ? (/ffmpeg version (\S+)/.exec(result.stdout)?.[1] ?? 'unknown') : null
  return cached
}

function run(cmd: string, args: string[], timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { timeout: timeoutMs })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else
        reject(new Error(`${cmd} exited ${code}: ${stderr.trim().split('\n').slice(-2).join(' ')}`))
    })
  })
}

export interface MediaProbe {
  width: number | null
  height: number | null
  durationMs: number | null
}

interface FfprobeStream {
  codec_type?: string
  width?: number
  height?: number
  duration?: string
  tags?: { rotate?: string }
  side_data_list?: { rotation?: number }[]
}

export async function probe(path: string): Promise<MediaProbe> {
  const out = await run('ffprobe', [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_streams',
    '-show_format',
    path,
  ])
  const data = JSON.parse(out) as { streams?: FfprobeStream[]; format?: { duration?: string } }
  const video = data.streams?.find((s) => s.codec_type === 'video')
  let width = video?.width ?? null
  let height = video?.height ?? null

  // Phone recordings store portrait video as landscape + a rotation flag.
  const rotation = Math.abs(
    Number(
      video?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ??
        video?.tags?.rotate ??
        0
    )
  )
  if (rotation === 90 || rotation === 270) [width, height] = [height, width]

  const seconds = Number(data.format?.duration ?? video?.duration)
  return {
    width,
    height,
    durationMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : null,
  }
}

// Writes one JPEG frame, scaled down to maxWidth. atMs = null for still images.
// One JPEG frame, at most `maxWidth` wide — or fitted inside maxWidth × maxHeight when given.
export async function extractFrame(
  input: string,
  output: string,
  atMs: number | null,
  maxWidth: number,
  maxHeight?: number
) {
  const seek = atMs === null ? [] : ['-ss', (atMs / 1000).toFixed(3)]
  await run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    ...seek,
    '-i',
    input,
    '-frames:v',
    '1',
    '-vf',
    maxHeight
      ? `scale='min(${maxWidth},iw)':'min(${maxHeight},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`
      : `scale='min(${maxWidth},iw)':-2`,
    '-q:v',
    '3',
    output,
  ])
}

export interface StreamInfo {
  durationMs: number | null
  peakBitrate: number | null
  video: {
    codec: string
    pixFmt: string
    width: number | null
    height: number | null
    fps: number | null
    hasBFrames: boolean
  } | null
}

// Codec details for output validation, plus the peak bitrate over any 1-second window.
export async function probeStreams(path: string): Promise<StreamInfo> {
  const out = await run('ffprobe', [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_streams',
    '-show_format',
    path,
  ])
  const data = JSON.parse(out) as {
    streams?: {
      codec_type?: string
      codec_name?: string
      pix_fmt?: string
      width?: number
      height?: number
      avg_frame_rate?: string
      has_b_frames?: number
    }[]
    format?: { duration?: string }
  }
  const v = data.streams?.find((s) => s.codec_type === 'video')
  const [num, den] = (v?.avg_frame_rate ?? '0/1').split('/').map(Number)
  const seconds = Number(data.format?.duration)

  let peakBitrate: number | null = null
  if (v && v.codec_name !== 'mjpeg' && v.codec_name !== 'png') {
    const packets = await run('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'packet=pts_time,size',
      '-of',
      'csv=p=0',
      path,
    ])
    const perSecond = new Map<number, number>()
    for (const line of packets.split('\n')) {
      const [time, size] = line.split(',').map(Number)
      if (!Number.isFinite(time) || !Number.isFinite(size)) continue
      const bucket = Math.floor(time!)
      perSecond.set(bucket, (perSecond.get(bucket) ?? 0) + size! * 8)
    }
    peakBitrate = perSecond.size ? Math.max(...perSecond.values()) : null
  }

  return {
    durationMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : null,
    peakBitrate,
    video: v
      ? {
          codec: v.codec_name ?? 'unknown',
          pixFmt: v.pix_fmt ?? 'unknown',
          width: v.width ?? null,
          height: v.height ?? null,
          fps: num && den ? Math.round((num / den) * 100) / 100 : null,
          hasBFrames: (v.has_b_frames ?? 0) > 0,
        }
      : null,
  }
}

// Rewrites the H.264 colour tags to BT.709 without re-encoding (WebCodecs tags sRGB transfer).
export async function retagBt709(input: string, output: string) {
  await run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    input,
    '-c',
    'copy',
    '-bsf:v',
    'h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1',
    '-color_primaries',
    'bt709',
    '-color_trc',
    'bt709',
    '-colorspace',
    'bt709',
    '-movflags',
    '+faststart',
    output,
  ])
}

// Proxy size: enough pixels for any crop a 1080×1920 output can ask for — a landscape clip
// filling a 9:16 story needs ~1920 px of height — so the short side keeps up to 2160 px (the
// long side up to 3840, what hardware decoders handle). Never scaled up; always even.
export function proxySize(width: number, height: number) {
  const factor = Math.min(1, 2160 / Math.min(width, height), 3840 / Math.max(width, height))
  const even = (n: number) => Math.max(2, Math.round((n * factor) / 2) * 2)
  return { width: even(width), height: even(height) }
}

// The template engine's decode source: constant 30 fps, a keyframe every 15 frames and no
// B-frames (fast, exact seeking), 8-bit 4:2:0 tagged BT.709, sized by proxySize, no audio.
export async function makeProxy(
  input: string,
  output: string,
  size: { width: number | null; height: number | null }
) {
  const target = size.width && size.height ? proxySize(size.width, size.height) : null
  const scale = target ? `scale=${target.width}:${target.height}:flags=lanczos,` : ''
  await run(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      input,
      '-an',
      '-sn',
      '-dn',
      '-vf',
      `${scale}fps=30,format=yuv420p`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-g',
      '15',
      '-keyint_min',
      '15',
      '-bf',
      '0',
      '-sc_threshold',
      '0',
      '-colorspace',
      'bt709',
      '-color_primaries',
      'bt709',
      '-color_trc',
      'bt709',
      // The flags above are dropped for untagged sources (ffmpeg keeps the input's "unknown");
      // write the tags into the stream itself.
      '-bsf:v',
      'h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1',
      '-movflags',
      '+faststart',
      output,
    ],
    30 * 60_000
  )
}

// macOS sips for HEIC/HEIF, which ffmpeg decodes badly. Scales to maxWidth, never up.
export async function sipsToJpeg(
  input: string,
  output: string,
  maxWidth: number,
  sourceWidth: number | null
) {
  const width = Math.min(maxWidth, sourceWidth ?? maxWidth)
  await run('sips', [
    '-s',
    'format',
    'jpeg',
    '-s',
    'formatOptions',
    '85',
    '--resampleWidth',
    String(width),
    input,
    '--out',
    output,
  ])
}

export async function sipsSize(input: string): Promise<{ width: number; height: number } | null> {
  const out = await run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', input])
  const width = Number(/pixelWidth: (\d+)/.exec(out)?.[1])
  const height = Number(/pixelHeight: (\d+)/.exec(out)?.[1])
  return width && height ? { width, height } : null
}

// ── Animated exports (GIF / WebP) ────────────────────────────────────────────────────────────

// Runs ffmpeg and reports how far through the input it has got (0–1). ffmpeg's own -progress
// is output-based, and neither palettegen nor the WebP muxer write anything until the end, so the
// filter chain carries `showinfo`, whose per-frame log line has the frame's pts_time.
function runWithProgress(
  args: string[],
  durationMs: number | null,
  onProgress?: (fraction: number) => void,
  timeoutMs = 30 * 60_000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'ffmpeg',
      ['-hide_banner', '-nostats', '-loglevel', 'info', '-y', ...args],
      {
        timeout: timeoutMs,
      }
    )
    const tail: string[] = []
    let pending = ''
    child.stdout.resume()
    child.stderr.on('data', (chunk) => {
      const lines = (pending + chunk).split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        const at = /pts_time:\s*([\d.]+)/.exec(line)
        if (at) {
          if (durationMs) onProgress?.(Math.min(1, (Number(at[1]) * 1000) / durationMs))
        } else if (line.trim()) {
          tail.push(line.trim())
          if (tail.length > 3) tail.shift()
        }
      }
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited ${code}: ${[...tail, pending.trim()].join(' ').trim()}`))
    })
  })
}

export interface AnimationOptions {
  width: number
  height: number
  fps: number
  durationMs: number | null
  onProgress?: (fraction: number) => void
}

const animationFilter = ({ width, height, fps }: AnimationOptions) =>
  `fps=${fps},showinfo=checksum=0,scale=${width}:${height}:flags=lanczos`

// Looping GIF in two passes: a 256-colour palette weighted towards what moves
// (stats_mode=diff), then ordered (Bayer, finest pattern) dithering that re-dithers only the
// rectangle that changed. Bayer rather than error diffusion: it doesn't crawl from frame to
// frame, so it looks steadier and the file is about half the size for the same smoothness.
// `palette` is a scratch PNG path; the caller removes it.
export async function makeGif(
  input: string,
  output: string,
  palette: string,
  options: AnimationOptions
) {
  const filter = animationFilter(options)
  // The palette pass is ~40% of the work.
  await runWithProgress(
    [
      '-i',
      input,
      '-an',
      '-vf',
      `${filter},palettegen=stats_mode=diff`,
      '-frames:v',
      '1',
      '-update',
      '1',
      '-f',
      'image2',
      palette,
    ],
    options.durationMs,
    (p) => options.onProgress?.(p * 0.4)
  )
  await runWithProgress(
    [
      '-i',
      input,
      '-i',
      palette,
      '-an',
      '-lavfi',
      `[0:v]${filter}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=1:diff_mode=rectangle`,
      '-loop',
      '0',
      '-f',
      'gif',
      output,
    ],
    options.durationMs,
    (p) => options.onProgress?.(0.4 + p * 0.6)
  )
}

// Looping animated WebP, lossy. Frames go in as RGB so libwebp does its own YUV conversion —
// handing it the render's BT.709 YUV would shift colours (WebP is BT.601).
// Quality 85, not 75: the animation encoder treats pixels within a quality-derived tolerance
// (±5 levels at 75, ±3 at 85) as unchanged and keeps the previous frame's there, which on slow
// fades and moving text leaves blotches and ghost trails. 85 clears most of it for ~1.5× the
// bytes — still a fraction of the GIF.
export async function makeAnimatedWebp(input: string, output: string, options: AnimationOptions) {
  await runWithProgress(
    [
      '-i',
      input,
      '-an',
      '-vf',
      `${animationFilter(options)},format=bgra`,
      '-c:v',
      'libwebp_anim',
      '-lossless',
      '0',
      '-quality',
      '85',
      '-compression_level',
      '4',
      '-loop',
      '0',
      '-f',
      'webp',
      output,
    ],
    options.durationMs,
    // The file is assembled after the last frame; hold just short of done until it is.
    (p) => options.onProgress?.(p * 0.97)
  )
}
