import type { Angle, Platform, PostFormat, PostStatus } from '@shared/constants.ts'

export const ANGLE_LABEL: Record<Angle, string> = {
  technical: 'Technical',
  personal: 'Personal',
  opinion: 'Opinion',
  business: 'Business',
  educational: 'Educational',
}

export const PLATFORM_LABEL: Record<Platform, string> = {
  x: 'X',
  linkedin: 'LinkedIn',
  ig_story: 'IG Story',
  ig_feed: 'IG Feed',
}

export const FORMAT_LABEL: Record<PostFormat, string> = {
  single: 'Single post',
  thread: 'Thread',
  story_seq: 'Story sequence',
  carousel: 'Carousel',
  reel: 'Reel',
}

export const STATUS_LABEL: Record<PostStatus, string> = {
  draft: 'Draft',
  review: 'Ready for review',
  approved: 'Approved',
  scheduled: 'Scheduled',
  published: 'Published',
  archived: 'Archived',
  discarded: 'Discarded',
}

// X counts every URL as 23 characters.
export const xLength = (text: string) => [...text.replace(/https?:\/\/\S+/g, 'x'.repeat(23))].length
