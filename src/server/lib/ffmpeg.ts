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
export async function extractFrame(
  input: string,
  output: string,
  atMs: number | null,
  maxWidth: number
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
    `scale='min(${maxWidth},iw)':-2`,
    '-q:v',
    '3',
    output,
  ])
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
