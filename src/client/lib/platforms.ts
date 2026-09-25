import type { Platform } from '@shared/constants.ts'
import type { Segment } from '@shared/types.ts'
import { xLength } from './labels.ts'

// Per-platform editing rules for the draft editor. The AI follows the same rules
// (server/ai/prompts/platforms.md) — keep the two in step.

export interface PlatformConfig {
  label: string
  title: (segments: Segment[]) => string
  // Hard or soft length limit per segment, and how length is counted.
  limit: number
  hardLimit: boolean
  length: (text: string) => number
  // Frames/slides carry their own media and render as images (Instagram).
  frames: false | { aspect: '9:16' | '4:5'; min: number; max: number; noun: string }
  caption: false | { limit: number }
  multiSegment: boolean
  quick: string[]
  copyText: (segments: Segment[], caption: string | null) => string
}

const plain = (text: string) => [...text].length

export const PLATFORMS: Record<Platform, PlatformConfig> = {
  x: {
    label: 'X',
    title: (s) => (s.length > 1 ? `X thread · ${s.length} posts` : 'X post'),
    limit: 280,
    hardLimit: true,
    length: xLength,
    frames: false,
    caption: false,
    multiSegment: true,
    quick: [
      'Shorter',
      'Less promotional',
      'More technical',
      'More conversational',
      'Make it a thread',
    ],
    copyText: (s) => s.map((x) => x.text).join('\n\n'),
  },
  linkedin: {
    label: 'LinkedIn',
    title: () => 'LinkedIn post',
    limit: 3000,
    hardLimit: true,
    length: plain,
    frames: false,
    caption: false,
    multiSegment: false,
    quick: ['Shorter', 'Stronger opening', 'More technical', 'More personal', 'Less promotional'],
    copyText: (s) => s.map((x) => x.text).join('\n\n'),
  },
  ig_story: {
    label: 'IG Story',
    title: (s) => `Instagram story · ${s.length} frame${s.length === 1 ? '' : 's'}`,
    limit: 120,
    hardLimit: false,
    length: plain,
    frames: { aspect: '9:16', min: 1, max: 10, noun: 'frame' },
    caption: false,
    multiSegment: true,
    quick: ['Fewer frames', 'Punchier text', 'More visual', 'Add a closing frame'],
    copyText: (s) => s.map((x, i) => `${i + 1}. ${x.text}`).join('\n'),
  },
  ig_feed: {
    label: 'IG Carousel',
    title: (s) => `Instagram carousel · ${s.length} slide${s.length === 1 ? '' : 's'}`,
    limit: 80,
    hardLimit: false,
    length: plain,
    frames: { aspect: '4:5', min: 1, max: 10, noun: 'slide' },
    caption: { limit: 2200 },
    multiSegment: true,
    quick: ['Shorter caption', 'Stronger first slide', 'More slides', 'Fewer slides'],
    copyText: (_s, caption) => caption ?? '',
  },
}

// LinkedIn shows roughly this many characters before "…see more".
export const LINKEDIN_FOLD = 210
