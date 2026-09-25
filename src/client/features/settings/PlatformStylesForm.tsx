import { useEffect, useState } from 'react'
import { PLATFORMS, type Platform } from '@shared/constants.ts'
import type { PlatformStyles } from '@shared/types.ts'
import { Button } from '../../components/Button/Button.tsx'
import type { ApiError } from '../../lib/api.ts'
import { PLATFORMS as PLATFORM_CONFIG } from '../../lib/platforms.ts'
import { useUpdateProfile, useWritingProfile } from '../../lib/queries.ts'
import './PlatformStylesForm.scss'

const PLACEHOLDER: Record<Platform, string> = {
  x: 'e.g. Lead with the technique. Mention the stack at the end. Never more than 3 posts in a thread.',
  linkedin: 'e.g. Write for clients as much as developers: say what the work made possible.',
  ig_story: 'e.g. Lowercase, very short lines. Last frame always says what’s next.',
  ig_feed: 'e.g. First slide: project name only. Credit the designer in the caption.',
}

// Mario's own notes per platform, added on top of Pullup's built-in platform rules.
export function PlatformStylesForm() {
  const { data: profile } = useWritingProfile()
  const update = useUpdateProfile()
  const [values, setValues] = useState<PlatformStyles>({})
  const [saved, setSaved] = useState(false)

  // Re-seed only when the styles themselves change — not when the voice form saves.
  const stored = profile ? JSON.stringify(profile.platformStyles) : undefined
  useEffect(() => {
    if (stored !== undefined) setValues(JSON.parse(stored))
  }, [stored])

  useEffect(() => {
    if (!saved) return
    const t = setTimeout(() => setSaved(false), 2000)
    return () => clearTimeout(t)
  }, [saved])

  if (!profile) return null
  const dirty = PLATFORMS.some(
    (p) => (values[p] ?? '').trim() !== (profile.platformStyles[p] ?? '').trim()
  )

  return (
    <form
      className="platform-styles flex flex-col"
      onSubmit={(e) => {
        e.preventDefault()
        const platformStyles = Object.fromEntries(
          PLATFORMS.map((p) => [p, (values[p] ?? '').trim()])
        ) as PlatformStyles
        update.mutate({ platformStyles }, { onSuccess: () => setSaved(true) })
      }}
    >
      <p className="platform-styles__help -p1">
        Pullup already follows each platform’s basics (length, format, no hashtags on X, frames for
        stories). Add your own preferences here — they’re used whenever drafts are written or
        revised for that platform.
      </p>
      <div className="platform-styles__grid">
        {PLATFORMS.map((p) => (
          <label key={p} className="platform-styles__field flex flex-col">
            <span className="platform-styles__label -meta">{PLATFORM_CONFIG[p].label}</span>
            <textarea
              className="platform-styles__input -p1"
              rows={4}
              value={values[p] ?? ''}
              placeholder={PLACEHOLDER[p]}
              onChange={(e) => setValues({ ...values, [p]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <div className="flex items-center justify-end">
        {saved ? <span className="platform-styles__saved -meta">Saved</span> : null}
        {dirty ? (
          <Button variant="ghost" size="s" onClick={() => setValues(profile.platformStyles)}>
            Reset
          </Button>
        ) : null}
        <Button variant="primary" size="s" type="submit" disabled={!dirty || update.isPending}>
          Save styles
        </Button>
      </div>
      {update.error ? (
        <p className="platform-styles__error -p1">{(update.error as ApiError).message}</p>
      ) : null}
    </form>
  )
}
