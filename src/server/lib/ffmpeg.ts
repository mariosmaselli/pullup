import { spawnSync } from 'node:child_process'

let cached: string | null | undefined

// Returns the ffmpeg version (e.g. "7.1.1"), or null when ffmpeg is not installed.
export function ffmpegVersion(): string | null {
  if (cached !== undefined) return cached
  const result = spawnSync('ffmpeg', ['-hide_banner', '-version'], { encoding: 'utf8' })
  cached =
    result.status === 0 ? (/ffmpeg version (\S+)/.exec(result.stdout)?.[1] ?? 'unknown') : null
  return cached
}
