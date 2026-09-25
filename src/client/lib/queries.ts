import { useQuery } from '@tanstack/react-query'
import type { Profile, SystemInfo } from '@shared/types.ts'
import { api } from './api.ts'

export const useSystem = () =>
  useQuery({ queryKey: ['system'], queryFn: () => api<SystemInfo>('/system') })

export const useProfiles = () =>
  useQuery({
    queryKey: ['profiles'],
    queryFn: () => api<Profile[]>('/profiles'),
    staleTime: Infinity,
  })
