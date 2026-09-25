// API response shapes shared by server and client.
import type {
  AssetKind,
  AssetSource,
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
}

export interface CaptureResult {
  asset: Asset
  duplicate: boolean
}
