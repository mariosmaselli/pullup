import { useEffect, useState } from 'react'
import { Button } from '../../components/Button/Button.tsx'
import type { ApiError } from '../../lib/api.ts'
import { useUpdateProfile, useWritingProfile } from '../../lib/queries.ts'
import './VoiceForm.scss'

// How the AI should sound when writing as Mario. Sent with every idea and draft request.
export function VoiceForm() {
  const { data: profile } = useWritingProfile()
  const update = useUpdateProfile()
  const [value, setValue] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (profile) setValue(profile.voiceGuide)
  }, [profile])

  useEffect(() => {
    if (!saved) return
    const t = setTimeout(() => setSaved(false), 2000)
    return () => clearTimeout(t)
  }, [saved])

  if (!profile) return null
  const dirty = value.trim() !== profile.voiceGuide

  return (
    <form
      className="voice-form flex flex-col"
      onSubmit={(e) => {
        e.preventDefault()
        if (dirty && value.trim())
          update.mutate({ voiceGuide: value.trim() }, { onSuccess: () => setSaved(true) })
      }}
    >
      <textarea
        className="voice-form__input -p"
        value={value}
        rows={5}
        aria-label="Writing voice"
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="voice-form__footer flex items-center justify-between">
        <p className="voice-form__help -p1">
          Used whenever Pullup suggests ideas or writes drafts. Describe how you write, what to
          avoid, and anything it should always keep in mind.
        </p>
        <div className="flex items-center shrink-0">
          {saved ? <span className="voice-form__saved -meta">Saved</span> : null}
          {dirty ? (
            <Button variant="ghost" size="s" onClick={() => setValue(profile.voiceGuide)}>
              Reset
            </Button>
          ) : null}
          <Button
            variant="primary"
            size="s"
            type="submit"
            disabled={!dirty || !value.trim() || update.isPending}
          >
            Save voice
          </Button>
        </div>
      </div>
      {update.error ? (
        <p className="voice-form__error -p1">{(update.error as ApiError).message}</p>
      ) : null}
    </form>
  )
}
