// API response shapes shared by server and client.

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
