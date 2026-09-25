import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { AiKeyStatus, SystemInfo } from '@shared/types.ts'
import { Button } from '../../components/Button/Button.tsx'
import { api, type ApiError } from '../../lib/api.ts'
import './AiKeyForm.scss'

// Paste-in field for the Anthropic API key. The key is checked with Anthropic and saved to
// pullup/.env by the server; the browser only ever gets back a short hint.
export function AiKeyForm({ system }: { system: SystemInfo }) {
  const queryClient = useQueryClient()
  const { key } = system.ai
  const [editing, setEditing] = useState(!key.configured)
  const [value, setValue] = useState('')

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['system'] })
  const save = useMutation({
    mutationFn: (apiKey: string) =>
      api<AiKeyStatus>('/settings/ai-key', { method: 'PUT', body: JSON.stringify({ apiKey }) }),
    onSuccess: () => {
      setValue('')
      setEditing(false)
      refresh()
    },
  })
  const remove = useMutation({
    mutationFn: () => api<AiKeyStatus>('/settings/ai-key', { method: 'DELETE' }),
    onSuccess: () => {
      setEditing(true)
      refresh()
    },
  })

  // Switching between the connected view and the form always starts clean: no leftover
  // pasted key, no stale error.
  const startEditing = (next: boolean) => {
    setValue('')
    save.reset()
    remove.reset()
    setEditing(next)
  }

  if (key.source === 'environment') {
    return (
      <div className="ai-key flex flex-col">
        <p className="-p1">
          Using <code>{key.hint}</code> from <code>ANTHROPIC_API_KEY</code> in your shell
          environment. A key pasted here would be ignored while that is set — to change it, update
          the variable and restart Pullup.
        </p>
      </div>
    )
  }

  if (key.configured && !editing) {
    return (
      <div className="ai-key ai-key--connected flex items-center justify-between">
        <p className="-p1">
          <span className="ai-key__dot" aria-hidden /> Connected · <code>{key.hint}</code>
        </p>
        <div className="flex items-center">
          <Button variant="ghost" size="s" onClick={() => startEditing(true)}>
            Replace
          </Button>
          <Button
            variant="danger"
            size="s"
            disabled={remove.isPending}
            onClick={() => {
              if (confirm('Remove the API key? AI features stop working until you add one again.'))
                remove.mutate()
            }}
          >
            Remove
          </Button>
        </div>
        {remove.error ? (
          <p className="ai-key__error ai-key__full -p1">{(remove.error as ApiError).message}</p>
        ) : null}
      </div>
    )
  }

  return (
    <form
      className="ai-key flex flex-col"
      onSubmit={(e) => {
        e.preventDefault()
        if (value.trim()) save.mutate(value)
      }}
    >
      <div className="ai-key__row flex items-center">
        {/* A masked text field rather than type=password, so password managers don't offer to
            store the API key as a website password. */}
        <input
          className="ai-key__input flex-1 -p"
          type="text"
          value={value}
          placeholder="sk-ant-…"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          aria-label="Anthropic API key"
          onChange={(e) => setValue(e.target.value)}
          disabled={save.isPending}
        />
        {key.configured ? (
          <Button variant="ghost" size="s" onClick={() => startEditing(false)}>
            Cancel
          </Button>
        ) : null}
        <Button variant="primary" size="s" type="submit" disabled={!value.trim() || save.isPending}>
          {save.isPending ? 'Checking…' : 'Save key'}
        </Button>
      </div>
      {save.error ? <p className="ai-key__error -p1">{(save.error as ApiError).message}</p> : null}
      <p className="ai-key__help -p1">
        Paste an API key from console.anthropic.com. Pullup checks it with Anthropic (no cost), then
        stores it in <code>pullup/.env</code> on this Mac — never in your library folder, and it’s
        never shown again.
      </p>
    </form>
  )
}
