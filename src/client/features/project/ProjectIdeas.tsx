import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import type { Project } from '@shared/types.ts'
import { Button } from '../../components/Button/Button.tsx'
import { useGenerateIdeas, useIdeas, useSystem } from '../../lib/queries.ts'
import { NewIdeaForm } from '../ideas/NewIdeaForm.tsx'
import './ProjectIdeas.scss'

// The most items one "Get ideas" call looks at (the server picks unused and recent ones first).
const MAX_ITEMS = 12

// "What could I post about this project?" — ideas from its whole material with an optional
// direction, or an idea written by hand (works with AI off).
export function ProjectIdeas({ project, readyCount }: { project: Project; readyCount: number }) {
  const { data: system } = useSystem()
  const { data: open = [] } = useIdeas()
  const generate = useGenerateIdeas()
  const navigate = useNavigate()
  const [instruction, setInstruction] = useState('')
  const [creating, setCreating] = useState(false)

  const openCount = open.filter((idea) => idea.projectId === project.id).length
  const items = Math.min(MAX_ITEMS, readyCount)
  const blocked =
    system && !system.ai.enabled
      ? 'AI isn’t set up — add your API key in Settings to get ideas. Ideas you write yourself work without it.'
      : !project.aiAllowed
        ? 'AI is off for this project, so nothing from it is sent to the AI. Ideas you write yourself still work.'
        : null

  const getIdeas = () =>
    generate.mutate(
      { projectId: project.id, instruction: instruction.trim() || undefined },
      { onSuccess: () => navigate({ to: '/ideas' }) }
    )

  return (
    <section className="project-ideas flex flex-col">
      <div className="flex items-center justify-between">
        <span className="project-ideas__label -meta">
          Ideas{openCount ? ` · ${openCount} open` : ''}
        </span>
        {openCount ? (
          <Link to="/ideas" className="project-ideas__link -p1">
            See open ideas
          </Link>
        ) : null}
      </div>

      {blocked ? (
        <p className="project-ideas__muted -p1">{blocked}</p>
      ) : (
        <textarea
          className="project-ideas__direction -p1"
          rows={2}
          maxLength={2000}
          value={instruction}
          disabled={generate.isPending}
          aria-label="Direction for the ideas"
          placeholder="Direction (optional) — e.g. a LinkedIn case study for agencies, or only what's new since the last post"
          onChange={(e) => setInstruction(e.target.value)}
        />
      )}

      <div className="project-ideas__actions flex items-center">
        {blocked ? null : (
          <Button variant="primary" disabled={!items || generate.isPending} onClick={getIdeas}>
            {generate.isPending
              ? 'Thinking of ideas…'
              : !items
                ? 'No material ready yet'
                : readyCount > MAX_ITEMS
                  ? `Get ideas from ${items} of ${readyCount} items`
                  : `Get ideas from ${items} item${items === 1 ? '' : 's'}`}
          </Button>
        )}
        <Button
          variant={blocked ? 'primary' : 'secondary'}
          onClick={() => setCreating(true)}
          disabled={creating}
        >
          New idea
        </Button>
        {readyCount > MAX_ITEMS && !blocked ? (
          <span className="project-ideas__muted -meta">Unused and newest items first</span>
        ) : null}
      </div>

      {generate.error ? (
        <p className="project-ideas__error -p1" role="alert">
          {generate.error.message}
        </p>
      ) : null}

      {creating ? (
        <NewIdeaForm
          projectId={project.id}
          onCancel={() => setCreating(false)}
          onCreated={() => navigate({ to: '/ideas' })}
        />
      ) : null}
    </section>
  )
}
