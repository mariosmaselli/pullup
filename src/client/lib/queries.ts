import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Asset, Profile, SystemInfo } from '@shared/types.ts'
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
export const useAssets = (scope: 'inbox' | 'all') =>
  useQuery({
    queryKey: ['assets', scope],
    queryFn: () => api<Asset[]>(`/assets?scope=${scope}`),
  })

// Refreshes every asset list plus sidebar counts.
export function useInvalidateAssets() {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: ['assets'] })
    queryClient.invalidateQueries({ queryKey: ['system'] })
  }
}

export interface AssetPatch {
  id: string
  title?: string
  notes?: string
  body?: string
  triaged?: boolean
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
