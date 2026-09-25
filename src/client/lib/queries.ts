import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Asset, Profile, Project, SystemInfo } from '@shared/types.ts'
import type { ProjectStatus, Visibility } from '@shared/constants.ts'
import { api } from './api.ts'

export const useSystem = () =>
  useQuery({ queryKey: ['system'], queryFn: () => api<SystemInfo>('/system') })

export const useProfiles = () =>
  useQuery({
    queryKey: ['profiles'],
    queryFn: () => api<Profile[]>('/profiles'),
    staleTime: Infinity,
  })

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
    for (const key of ['assets', 'projects', 'system']) {
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
