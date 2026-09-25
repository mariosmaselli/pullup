import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  Asset,
  Idea,
  PlatformStyles,
  Post,
  PostDetail,
  Profile,
  Project,
  Segment,
  SystemInfo,
} from '@shared/types.ts'
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
    mutationFn: (body: { assetIds: string[]; instruction?: string }) =>
      api<Idea[]>('/ideas/generate', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ideas'] }),
  })
}

export function useUpdateIdea() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: IdeaStatus }) =>
      api<Idea>(`/ideas/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ideas'] }),
  })
}

export function useDraftIdea() {
  const queryClient = useQueryClient()
  return useMutation({
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

export const usePosts = (status?: string) =>
  useQuery({
    queryKey: ['posts', status ?? 'open'],
    queryFn: () => api<Post[]>(`/posts${status ? `?status=${status}` : ''}`),
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
    ({ id, segments, caption }: { id: string; segments: Segment[]; caption?: string | null }) =>
      api<PostDetail>(`/posts/${id}/revisions`, {
        method: 'POST',
        body: JSON.stringify({ segments, caption }),
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
      publicUrl?: string | null
      publishedAt?: string | null
    }) => api<PostDetail>(`/posts/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
  )
