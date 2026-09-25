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
  ProcessingStatus,
  ProjectStatus,
  Visibility,
} from './constants.ts'

export interface Profile {
  id: string
  slug: string
  name: string
  voiceGuide: string
  platformPrefs: Record<string, unknown>
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
  role: 'thumb' | 'poster' | 'frame' | 'og_image'
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

export interface PostRevision {
  id: string
  segments: { text: string }[]
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
  // Other drafts generated from the same idea for the same platform.
  siblings: { id: string; angle: Angle | null; status: PostStatus }[]
}

export interface AiRunSummary {
  runs: number
  costUsd: number
}

export interface CaptureResult {
  asset: Asset
  duplicate: boolean
}
