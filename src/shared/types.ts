// API response shapes shared by server and client.
import type {
  Angle,
  AssetKind,
  AssetSource,
  IdeaOrigin,
  IdeaStatus,
  Platform,
  PostFormat,
  PostStatus,
  SegmentKind,
  ProcessingStatus,
  ProjectStatus,
  Visibility,
} from './constants.ts'

// Mario's own notes per platform, added to the built-in platform rules when writing.
export type PlatformStyles = Partial<Record<Platform, string>>

export interface Profile {
  id: string
  slug: string
  name: string
  voiceGuide: string
  platformStyles: PlatformStyles
}

export interface Backup {
  name: string
  kind: 'snapshot' | 'migration'
  createdAt: string
  sizeBytes: number
}

export interface BackupStatus {
  folder: string
  latest: Backup | null
  snapshots: number
  keep: number
}

export interface SystemInfo {
  version: string
  library: {
    root: string
    inbox: string
    database: string
  }
  ffmpeg: string | null
  ai: { enabled: boolean; runs: number; costUsd: number; key: AiKeyStatus }
  counts: {
    inbox: number
    assets: number
    projects: number
    ideas: number
    posts: number
  }
}

export interface Project {
  id: string
  name: string
  slug: string
  description: string
  status: ProjectStatus
  isClientWork: boolean
  aiAllowed: boolean
  tags: string[]
  defaultProfileId: string | null
  assetCount: number
  coverAssetId: string | null
  lastCapturedAt: string | null
  createdAt: string
  updatedAt: string
}

// The key itself is never sent to the browser — only whether it's set and a short hint.
export interface AiKeyStatus {
  configured: boolean
  source: 'environment' | 'env-file' | null
  hint: string | null
}

export interface LinkMeta {
  url: string
  title: string | null
  description: string | null
  siteName: string | null
  image: string | null
  icon: string | null
}

export interface AssetDerivative {
  role: 'thumb' | 'poster' | 'frame' | 'og_image' | 'proxy'
  url: string
  width: number | null
  height: number | null
  timeMs: number | null
}

export interface Asset {
  id: string
  kind: AssetKind
  title: string
  notes: string
  source: AssetSource
  projectId: string | null
  tags: string[]
  visibility: Visibility
  processingStatus: ProcessingStatus
  processingError: string | null
  triagedAt: string | null
  capturedAt: string
  createdAt: string
  updatedAt: string
  file: {
    url: string
    path: string
    originalName: string
    mime: string
    sizeBytes: number
    width: number | null
    height: number | null
    durationMs: number | null
  } | null
  link: { url: string; meta: LinkMeta | null } | null
  body: string | null
  thumbUrl: string | null
  derivatives: AssetDerivative[]
  analysis: AssetAnalysis | null
}

// AI suggestions for an asset — kept apart from what Mario entered.
export interface AssetAnalysis {
  id: string
  description: string
  subjects: string[]
  suggestedTags: string[]
  suggestedProjectId: string | null
  hooks: string[]
  questions: string[]
  createdAt: string
}

export interface Idea {
  id: string
  title: string
  summary: string
  angle: Angle | null
  format: PostFormat | null
  platforms: Platform[]
  rationale: string
  questions: string[]
  origin: IdeaOrigin
  status: IdeaStatus
  profileId: string | null
  projectId: string | null
  sources: { assetId: string; note: string }[]
  createdAt: string
}

// basis: 'source' = stated in Mario's material, 'framing' = editorial framing,
// 'unconfirmed' = plausible but needs Mario to confirm before publishing.
export interface Claim {
  text: string
  basis: 'source' | 'framing' | 'unconfirmed'
  assetId: string | null
}

// One X post in a thread, the LinkedIn post, an Instagram story frame or carousel slide.
// Frames and slides can show media — X and LinkedIn media are attached per post.
// Read a frame's media with frameAssetIds() (src/shared/frames.ts), never assetId alone.
export interface Segment {
  text: string
  // The frame's first media (and its kind): kept for the AI and older revisions.
  assetId?: string | null
  kind?: SegmentKind | null
  // Every image/video the frame shows, in order (assetIds[0] === assetId). Absent on older
  // revisions and text frames.
  assetIds?: string[] | null
  // Instagram frames/slides: which template renders this frame, and its settings.
  template?: FrameTemplate | null
}

export interface FrameTemplate {
  id: string
  params?: Record<string, unknown>
  duration?: number
}

export interface PostRevision {
  id: string
  segments: Segment[]
  caption: string | null
  author: 'ai' | 'me'
  instruction: string | null
  claims: Claim[]
  questions: string[]
  createdAt: string
}

export interface Post {
  id: string
  ideaId: string | null
  profileId: string
  projectId: string | null
  platform: Platform
  format: PostFormat
  angle: Angle | null
  status: PostStatus
  scheduledFor: string | null
  publishedAt: string | null
  publicUrl: string | null
  current: PostRevision | null
  mediaAssetIds: string[]
  createdAt: string
  updatedAt: string
}

export interface PostDetail extends Post {
  revisions: PostRevision[]
  sourceAssetIds: string[]
  // Every draft made from the same idea, across platforms.
  siblings: { id: string; platform: Platform; angle: Angle | null; status: PostStatus }[]
}

export interface AiRunSummary {
  runs: number
  costUsd: number
}

export interface CaptureResult {
  asset: Asset
  duplicate: boolean
}
