import { createContext, useContext, useState, type ReactNode } from 'react'

// Global identity filter: 'all' or a profile slug. Remembered per browser.
type ProfileFilter = 'all' | (string & {})

const STORAGE_KEY = 'pullup:profile'

const read = (): ProfileFilter => {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? 'all'
  } catch {
    return 'all'
  }
}

const ProfileContext = createContext<{
  profile: ProfileFilter
  setProfile: (value: ProfileFilter) => void
} | null>(null)

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setState] = useState<ProfileFilter>(read)

  const setProfile = (value: ProfileFilter) => {
    setState(value)
    try {
      localStorage.setItem(STORAGE_KEY, value)
    } catch {
      // Storage unavailable — keep the in-memory value.
    }
  }

  return <ProfileContext value={{ profile, setProfile }}>{children}</ProfileContext>
}

export function useProfileFilter() {
  const ctx = useContext(ProfileContext)
  if (!ctx) throw new Error('useProfileFilter must be used inside <ProfileProvider>')
  return ctx
}
