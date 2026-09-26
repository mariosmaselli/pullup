import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { PLATFORMS as PLATFORM_IDS, type Platform } from '@shared/constants.ts'
import { Button } from '../../components/Button/Button.tsx'
import { ProjectPicker } from '../../components/ProjectPicker/ProjectPicker.tsx'
import type { ApiError } from '../../lib/api.ts'
import { PLATFORMS } from '../../lib/platforms.ts'
import { useCreatePosts, useIdeas } from '../../lib/queries.ts'
import './NewDraftPanel.scss'

interface Props {
  onClose: () => void
}

// A blank draft, written by hand — no AI involved, so it works for client work with AI off.
export function NewDraftPanel({ onClose }: Props) {
  const navigate = useNavigate()
  const create = useCreatePosts()
  const { data: ideas = [] } = useIdeas('suggested,saved,drafted')
  const [platforms, setPlatforms] = useState<Platform[]>(['x'])
  const [ideaId, setIdeaId] = useState('')
  const [projectId, setProjectId] = useState<string | null>(null)
  const error = create.error as ApiError | null

  const toggle = (platform: Platform) =>
    setPlatforms((all) =>
      all.includes(platform)
        ? all.filter((p) => p !== platform)
        : PLATFORM_IDS.filter((p) => p === platform || all.includes(p))
    )

  const submit = () =>
    create.mutate(
      { platforms, ideaId: ideaId || null, projectId },
      {
        onSuccess: ({ postIds }) => navigate({ to: '/drafts/$id', params: { id: postIds[0]! } }),
      }
    )

  return (
    <form
      className="new-draft-panel flex flex-col"
      onSubmit={(e) => {
        e.preventDefault()
        if (platforms.length) submit()
      }}
    >
      <div className="new-draft-panel__head flex items-center justify-between">
        <span className="new-draft-panel__label -meta">New draft</span>
        <Button variant="ghost" size="s" onClick={onClose}>
          Cancel
        </Button>
      </div>

      <fieldset className="new-draft-panel__field flex flex-col">
        <legend className="new-draft-panel__label -meta">Platforms</legend>
        <div className="new-draft-panel__platforms flex">
          {PLATFORM_IDS.map((platform) => (
            <label
              key={platform}
              className="new-draft-panel__platform flex items-center -p1"
              data-checked={platforms.includes(platform)}
            >
              <input
                type="checkbox"
                checked={platforms.includes(platform)}
                onChange={() => toggle(platform)}
              />
              {PLATFORMS[platform].label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="new-draft-panel__row flex">
        <label className="new-draft-panel__field flex flex-col flex-1">
          <span className="new-draft-panel__label -meta">Idea (optional)</span>
          <select
            className="new-draft-panel__select -p"
            value={ideaId}
            onChange={(e) => {
              setIdeaId(e.target.value)
              const idea = ideas.find((i) => i.id === e.target.value)
              if (idea) setProjectId(idea.projectId)
            }}
          >
            <option value="">No idea — start from nothing</option>
            {ideas.map((idea) => (
              <option key={idea.id} value={idea.id}>
                {idea.title}
                {idea.status === 'drafted' ? ' · drafted' : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="new-draft-panel__field flex flex-col flex-1">
          <span className="new-draft-panel__label -meta">Project (optional)</span>
          <ProjectPicker value={projectId} onChange={setProjectId} />
        </div>
      </div>

      <p className="new-draft-panel__hint -p1">
        {ideaId
          ? 'The drafts join the idea’s package, so they show up as tabs next to its other drafts.'
          : platforms.length > 1
            ? 'Without an idea, each platform starts as its own draft.'
            : 'Starts blank. Nothing is sent to the AI.'}
      </p>

      {error ? <p className="new-draft-panel__error -p1">{error.message}</p> : null}

      <div className="flex items-center justify-end">
        <Button
          variant="primary"
          size="s"
          type="submit"
          disabled={!platforms.length || create.isPending}
        >
          {platforms.length > 1 ? `Create ${platforms.length} drafts` : 'Create draft'}
        </Button>
      </div>
    </form>
  )
}
