import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  Asset,
  BackupStatus,
  Idea,
  PlatformStyles,
  Post,
  PostDetail,
  Profile,
  Project,
  Segment,
  SystemInfo,
} from '@shared/types.ts'
import type { Render } from '@shared/template.ts'
import type {
  IdeaStatus,
  Platform,
  PostStatus,
  ProjectStatus,
  Visibility,
} from '@shared/constants.ts'
import { api } from './api.ts'

export const useSystem = () =>
  useQuery({ queryKey: ['system'], queryFn: () => api<SystemInfo>('/system') })

export const useBackups = () =>
  useQuery({ queryKey: ['backups'], queryFn: () => api<BackupStatus>('/system/backups') })

export function useBackUpNow() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api<BackupStatus>('/system/backups', { method: 'POST' }),
    onSuccess: (status) => queryClient.setQueryData(['backups'], status),
  })
}

// The identity drafts are written as — currently always Mario.
export const useWritingProfile = () =>
  useQuery({ queryKey: ['profile'], queryFn: () => api<Profile>('/profiles/current') })

export function useUpdateProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { voiceGuide?: string; platformStyles?: PlatformStyles }) =>
      api<Profile>('/profiles/current', { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: (profile) => queryClient.setQueryData(['profile'], profile),
  })
}

// Kept fresh by server events (lib/events.ts) — no polling.
export const useAssets = (scope: 'inbox' | 'all', projectId?: string) =>
  useQuery({
    queryKey: ['assets', scope, projectId ?? null],
    queryFn: () =>
      api<Asset[]>(`/assets?scope=${scope}${projectId ? `&project=${projectId}` : ''}`),
    enabled: projectId !== '',
  })

export const useProjects = () =>
  useQuery({ queryKey: ['projects'], queryFn: () => api<Project[]>('/projects') })

export const useProject = (slug: string) =>
  useQuery({ queryKey: ['projects', slug], queryFn: () => api<Project>(`/projects/${slug}`) })

export interface ProjectPatch {
  name?: string
  description?: string
  status?: ProjectStatus
  isClientWork?: boolean
  aiAllowed?: boolean
  tags?: string[]
}

export function useCreateProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: ProjectPatch & { name: string }) =>
      api<Project>('/projects', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  })
}

export function useUpdateProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: ProjectPatch & { id: string }) =>
      api<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  })
}

// Refreshes every asset list plus sidebar counts.
export function useInvalidateAssets() {
  const queryClient = useQueryClient()
  return () => {
    for (const key of ['assets', 'projects', 'ideas', 'posts', 'system']) {
      queryClient.invalidateQueries({ queryKey: [key] })
    }
  }
}

export interface AssetPatch {
  id: string
  title?: string
  notes?: string
  body?: string
  triaged?: boolean
  projectId?: string | null
  visibility?: Visibility
}

export function useUpdateAsset() {
  const invalidate = useInvalidateAssets()
  return useMutation({
    mutationFn: ({ id, ...body }: AssetPatch) =>
      api<Asset>(`/assets/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: invalidate,
  })
}

export function useDeleteAsset() {
  const invalidate = useInvalidateAssets()
  return useMutation({
    mutationFn: (id: string) => api<null>(`/assets/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })
}

export function useReprocessAsset() {
  const invalidate = useInvalidateAssets()
  return useMutation({
    mutationFn: (id: string) => api<Asset>(`/assets/${id}/reprocess`, { method: 'POST' }),
    onSuccess: invalidate,
  })
}

// ── AI ────────────────────────────────────────────────────────────────────────

export function useAnalyzeAsset() {
  const invalidate = useInvalidateAssets()
  return useMutation({
    mutationFn: (id: string) => api<Asset>(`/assets/${id}/analyze`, { method: 'POST' }),
    onSuccess: invalidate,
  })
}

export const useIdeas = (status = 'suggested,saved') =>
  useQuery({ queryKey: ['ideas', status], queryFn: () => api<Idea[]>(`/ideas?status=${status}`) })

export function useGenerateIdeas() {
  const queryClient = useQueryClient()
  return useMutation({
    // Some assets, or a whole project's material (the server picks up to 12 of its items).
    mutationFn: (body: { assetIds?: string[]; projectId?: string; instruction?: string }) =>
      api<Idea[]>('/ideas/generate', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ideas'] }),
  })
}

export function useUpdateIdea() {
  const queryClient = useQueryClient()
  return useMutation({
    // answers: Mario's answer to each of the idea's questions, in order.
    mutationFn: ({ id, ...body }: { id: string; status?: IdeaStatus; answers?: string[] }) =>
      api<Idea>(`/ideas/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ideas'] }),
  })
}

// An idea written by hand (no AI).
import type { Angle } from '@shared/constants.ts'

export interface NewIdeaInput {
  title: string
  summary?: string
  angle?: Angle | null
  format?: 'single' | 'thread' | 'story_seq' | 'carousel' | null
  platforms?: Platform[]
  assetIds?: string[]
  projectId?: string | null
}

export function useCreateIdea() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: NewIdeaInput) =>
      api<Idea>('/ideas', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ideas'] }),
  })
}

// Keyed so the Ideas view can see drafts still being written after it remounts.
export const DRAFT_IDEA_KEY = ['ideas', 'draft']

export function useDraftIdea() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: DRAFT_IDEA_KEY,
    mutationFn: ({ id, ...body }: { id: string; platforms?: Platform[]; instruction?: string }) =>
      api<{ postIds: string[]; skipped: Platform[] }>(`/ideas/${id}/draft`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ideas'] })
      queryClient.invalidateQueries({ queryKey: ['posts'] })
    },
  })
}

export const usePosts = (status?: string, projectId?: string) =>
  useQuery({
    queryKey: ['posts', status ?? 'open', projectId ?? 'all'],
    queryFn: () => {
      const query = new URLSearchParams()
      if (status) query.set('status', status)
      if (projectId) query.set('project', projectId)
      return api<Post[]>(`/posts${query.size ? `?${query}` : ''}`)
    },
  })

export const usePost = (id: string) =>
  useQuery({ queryKey: ['posts', 'detail', id], queryFn: () => api<PostDetail>(`/posts/${id}`) })

function usePostMutation<V>(request: (vars: V) => Promise<PostDetail>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: request,
    onSuccess: (post) => {
      queryClient.setQueryData(['posts', 'detail', post.id], post)
      queryClient.invalidateQueries({ queryKey: ['posts'] })
    },
  })
}

export const useSavePostRevision = () =>
  usePostMutation(
    ({
      id,
      segments,
      caption,
      confirmedClaims,
    }: {
      id: string
      segments: Segment[]
      caption?: string | null
      // Positions of the 'unconfirmed' claims checked off in this edit.
      confirmedClaims?: number[]
    }) =>
      api<PostDetail>(`/posts/${id}/revisions`, {
        method: 'POST',
        body: JSON.stringify({ segments, caption, confirmedClaims }),
      })
  )

export const useRevisePost = () =>
  usePostMutation(({ id, instruction }: { id: string; instruction: string }) =>
    api<PostDetail>(`/posts/${id}/revise`, {
      method: 'POST',
      body: JSON.stringify({ instruction }),
    })
  )

export const useRestoreRevision = () =>
  usePostMutation(({ id, revisionId }: { id: string; revisionId: string }) =>
    api<PostDetail>(`/posts/${id}/restore/${revisionId}`, { method: 'POST' })
  )

export const useUpdatePost = () =>
  usePostMutation(
    ({
      id,
      ...body
    }: {
      id: string
      status?: PostStatus
      scheduledFor?: string | null
      publicUrl?: string | null
      publishedAt?: string | null
      // A local day (YYYY-MM-DD) the post is pencilled onto, without scheduling it.
      plannedFor?: string | null
      projectId?: string | null
    }) => api<PostDetail>(`/posts/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
  )

export const useApproveMedia = () =>
  usePostMutation((id: string) => api<PostDetail>(`/posts/${id}/approve-media`, { method: 'POST' }))

// ── Posts made by hand, attached media ──────────────────────────────────────────────────────

// Blank drafts, one per platform (no AI).
export function useCreatePosts() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      platforms: Platform[]
      projectId?: string | null
      ideaId?: string | null
    }) => api<{ postIds: string[] }>('/posts', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] })
      queryClient.invalidateQueries({ queryKey: ['ideas'] })
    },
  })
}

export interface LoggedPost {
  platform: Platform
  text: string
  publicUrl: string | null
  publishedAt: string
  assetIds: string[]
  projectId: string | null
  // "It's posted already": make its private media public.
  approveMedia?: boolean
}

// Record a post that went out without Pullup.
export function useLogPost() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: LoggedPost) =>
      api<PostDetail>('/posts/log', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (post) => {
      queryClient.setQueryData(['posts', 'detail', post.id], post)
      for (const key of ['posts', 'assets']) queryClient.invalidateQueries({ queryKey: [key] })
    },
  })
}

// X / LinkedIn: the post's attached media, in order.
export const useSetPostMedia = () =>
  usePostMutation(({ id, assetIds }: { id: string; assetIds: string[] }) =>
    api<PostDetail>(`/posts/${id}/media`, { method: 'PUT', body: JSON.stringify({ assetIds }) })
  )

// ── Renders ───────────────────────────────────────────────────────────────────────────────

export const useRenders = (postId?: string) =>
  useQuery({
    queryKey: ['renders', postId ?? 'all'],
    queryFn: () => api<Render[]>(postId ? `/renders?post=${postId}` : '/renders'),
  })

export function useDeleteRender() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<null>(`/renders/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['renders'] }),
  })
}

// ── Render exports (GIF / animated WebP) ──────────────────────────────────────────────────────

import type {
  ExportFormat,
  ExportPreset,
  RenderExport,
  RenderWithExports,
} from '@shared/render-exports.ts'

// A render's exports. Progress lives on the server: poll while one is being made (`poll` covers
// the moment between asking and the server listing it).
export const useRenderExports = (renderId: string | null, poll = false) =>
  useQuery({
    queryKey: ['renders', 'exports', renderId],
    queryFn: () => api<RenderWithExports>(`/renders/${renderId}`),
    enabled: !!renderId,
    select: (render) => render.exports,
    refetchInterval: (query) =>
      poll || query.state.data?.exports.some((e) => e.status === 'pending') ? 500 : false,
  })

export function useCreateRenderExport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      renderId,
      format,
      preset,
    }: {
      renderId: string
      format: ExportFormat
      preset: ExportPreset
    }) =>
      api<RenderExport>(`/renders/${renderId}/exports`, {
        method: 'POST',
        body: JSON.stringify({ format, preset }),
      }),
    // Show the finished file straight away (no flash of the Export button before the refetch).
    onSuccess: (made, { renderId }) =>
      queryClient.setQueryData<RenderWithExports>(
        ['renders', 'exports', renderId],
        (render) =>
          render && {
            ...render,
            exports: [
              ...render.exports.filter((e) => e.format !== made.format || e.preset !== made.preset),
              made,
            ],
          }
      ),
    onSettled: (_data, _error, { renderId }) =>
      queryClient.invalidateQueries({ queryKey: ['renders', 'exports', renderId] }),
  })
}

// ── Housekeeping: storage, old-render cleanup, trash, fonts, AI spend ─────────────────────────
// Keyed under 'system' so server change events keep them fresh.

import type {
  AiUsage,
  CleanupPreview,
  CleanupResult,
  EmptyTrashResult,
  FontFolder,
  RestoreResult,
  StorageInfo,
  TrashListing,
} from '@shared/storage.ts'

export const useStorage = () =>
  useQuery({ queryKey: ['system', 'storage'], queryFn: () => api<StorageInfo>('/storage') })

// What "Clean up old renders" would move — fetched only once asked for.
export const useCleanupPreview = (enabled: boolean) =>
  useQuery({
    queryKey: ['system', 'storage', 'cleanup'],
    queryFn: () => api<CleanupPreview>('/storage/cleanup'),
    enabled,
  })

function useInvalidateHousekeeping() {
  const queryClient = useQueryClient()
  return () => {
    for (const key of ['system', 'renders', 'assets']) {
      queryClient.invalidateQueries({ queryKey: [key] })
    }
  }
}

export function useCleanUpRenders() {
  const invalidate = useInvalidateHousekeeping()
  return useMutation({
    mutationFn: (ids: string[]) =>
      api<CleanupResult>('/storage/cleanup', { method: 'POST', body: JSON.stringify({ ids }) }),
    onSuccess: invalidate,
  })
}

export const useTrash = () =>
  useQuery({ queryKey: ['system', 'trash'], queryFn: () => api<TrashListing>('/storage/trash') })

export function useRestoreFromTrash() {
  const invalidate = useInvalidateHousekeeping()
  return useMutation({
    mutationFn: (name: string) =>
      api<RestoreResult>('/storage/trash/restore', {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),
    onSettled: invalidate,
  })
}

export function useEmptyTrash() {
  const invalidate = useInvalidateHousekeeping()
  return useMutation({
    mutationFn: (names: string[]) =>
      api<EmptyTrashResult>('/storage/trash/empty', {
        method: 'POST',
        body: JSON.stringify({ names }),
      }),
    onSettled: invalidate,
  })
}

export const useFontFolder = () =>
  useQuery({ queryKey: ['system', 'fonts'], queryFn: () => api<FontFolder>('/system/fonts') })

export const useAiUsage = () =>
  useQuery({ queryKey: ['system', 'ai-usage'], queryFn: () => api<AiUsage>('/system/ai-usage') })

// ── Assets: Library search, tags, usage, selection actions, inbox folder ─────────────────────

import { keepPreviousData } from '@tanstack/react-query'
import type {
  AssetFilters,
  AssetUsage,
  BulkDeleteResult,
  InboxIssue,
  TagCount,
} from '@shared/types.ts'

// Adds tags to the asset edit above (interface merging).
export interface AssetPatch {
  tags?: string[]
}

const assetQuery = (scope: 'inbox' | 'all', filters: AssetFilters) => {
  const query = new URLSearchParams({ scope })
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value)
  return `/assets?${query}`
}

// Filtered on the server (lists are capped). The previous result stays while typing.
export const useAssetSearch = (scope: 'inbox' | 'all', filters: AssetFilters) =>
  useQuery({
    queryKey: ['assets', scope, 'search', filters],
    queryFn: () => api<Asset[]>(assetQuery(scope, filters)),
    placeholderData: keepPreviousData,
  })

// One asset — for a panel whose asset left the list it was opened from (e.g. moved project).
export const useAsset = (id: string | null, enabled = true) =>
  useQuery({
    queryKey: ['assets', 'one', id],
    queryFn: () => api<Asset>(`/assets/${id}`),
    enabled: !!id && enabled,
    retry: false,
  })

export const useAssetTags = () =>
  useQuery({ queryKey: ['assets', 'tags'], queryFn: () => api<TagCount[]>('/assets/tags') })

export const useAssetUsage = (id: string) =>
  useQuery({
    queryKey: ['assets', 'usage', id],
    queryFn: () => api<AssetUsage>(`/assets/${id}/usage`),
  })

export function useBulkUpdateAssets() {
  const invalidate = useInvalidateAssets()
  return useMutation({
    mutationFn: (body: { ids: string[]; projectId?: string | null; triaged?: boolean }) =>
      api<{ updated: number }>('/assets/bulk', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: invalidate,
  })
}

export function useBulkDeleteAssets() {
  const invalidate = useInvalidateAssets()
  return useMutation({
    mutationFn: (ids: string[]) =>
      api<BulkDeleteResult>('/assets/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      }),
    onSuccess: invalidate,
  })
}

// A thumbnail failed to load: the server rebuilds cached files that were deleted.
export const repairAsset = (id: string) =>
  api<{ queued: boolean }>(`/assets/${id}/repair`, { method: 'POST' })

export const useInboxIssues = () =>
  useQuery({
    queryKey: ['assets', 'inbox-issues'],
    queryFn: () => api<InboxIssue[]>('/assets/inbox-issues'),
  })

export function useInboxIssueAction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ name, action }: { name: string; action: 'retry' | 'trash' }) =>
      api<{ ok: true }>(`/assets/inbox-issues/${action}`, {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['assets', 'inbox-issues'] }),
  })
}
