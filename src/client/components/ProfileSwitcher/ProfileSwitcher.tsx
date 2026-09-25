import { useProfiles } from '../../lib/queries.ts'
import { useProfileFilter } from '../../lib/profile.tsx'
import './ProfileSwitcher.scss'

// Short labels for the segmented control; falls back to the profile name.
const SHORT: Record<string, string> = { mario: 'Mario', nonlinear: 'Nonlinear' }

export function ProfileSwitcher() {
  const { data: profiles = [] } = useProfiles()
  const { profile, setProfile } = useProfileFilter()

  const options = [
    { value: 'all', label: 'All' },
    ...profiles.map((p) => ({ value: p.slug, label: SHORT[p.slug] ?? p.name })),
  ]

  return (
    <div className="profile-switcher flex" role="radiogroup" aria-label="Content identity">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={profile === option.value}
          className="profile-switcher__option flex-1 -p1"
          onClick={() => setProfile(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
