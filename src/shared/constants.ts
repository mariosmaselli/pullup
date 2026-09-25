// Enum values shared by the database CHECK constraints, the API and the UI.
// Keep in sync with src/server/db/migrations.

export const ASSET_KINDS = ['image', 'video', 'link', 'note'] as const
export const ASSET_SOURCES = ['drop', 'paste', 'inbox_folder', 'url', 'note', 'shortcut'] as const
export const VISIBILITY = ['private', 'approved'] as const
export const PROCESSING_STATUS = ['pending', 'processing', 'ready', 'failed'] as const

export const PROJECT_STATUS = ['active', 'paused', 'done', 'archived'] as const

export const ANGLES = ['technical', 'personal', 'opinion', 'business', 'educational'] as const
export const IDEA_ORIGINS = ['discovery', 'manual', 'asset'] as const
export const IDEA_STATUS = ['suggested', 'saved', 'dismissed', 'drafted'] as const

export const PLATFORMS = ['x', 'ig_story', 'ig_feed'] as const
export const POST_FORMATS = ['single', 'thread', 'story_seq', 'carousel', 'reel'] as const
export const POST_STATUS = [
  'draft',
  'review',
  'approved',
  'scheduled',
  'published',
  'archived',
  'discarded',
] as const

export type AssetKind = (typeof ASSET_KINDS)[number]
export type AssetSource = (typeof ASSET_SOURCES)[number]
export type Visibility = (typeof VISIBILITY)[number]
export type ProcessingStatus = (typeof PROCESSING_STATUS)[number]
export type ProjectStatus = (typeof PROJECT_STATUS)[number]
export type Angle = (typeof ANGLES)[number]
export type IdeaOrigin = (typeof IDEA_ORIGINS)[number]
export type IdeaStatus = (typeof IDEA_STATUS)[number]
export type Platform = (typeof PLATFORMS)[number]
export type PostFormat = (typeof POST_FORMATS)[number]
export type PostStatus = (typeof POST_STATUS)[number]
