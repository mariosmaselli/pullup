import { describe, expect, it } from 'vitest'
import { proxySize } from './ffmpeg.ts'

describe('proxySize', () => {
  it('keeps enough pixels for a 1080×1920 crop, never scales up, stays even', () => {
    // Mario's recordings today: already small enough, untouched.
    expect(proxySize(1704, 1104)).toEqual({ width: 1704, height: 1104 })
    // A Retina screen recording keeps a 2160 px short side (a 9:16 crop needs ~1920).
    expect(proxySize(3456, 2234)).toEqual({ width: 3342, height: 2160 })
    expect(proxySize(3840, 2160)).toEqual({ width: 3840, height: 2160 })
    expect(proxySize(2160, 3840)).toEqual({ width: 2160, height: 3840 })
    // 8K comes down to 4K; a very tall capture is bounded by its long side.
    expect(proxySize(7680, 4320)).toEqual({ width: 3840, height: 2160 })
    expect(proxySize(1440, 9000)).toEqual({ width: 614, height: 3840 })
    // Odd sizes round to the nearest even number (H.264 4:2:0).
    expect(proxySize(1081, 721)).toEqual({ width: 1082, height: 722 })
  })
})
