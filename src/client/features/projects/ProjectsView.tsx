import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ViewHeader } from '../../components/ViewHeader/ViewHeader.tsx'
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx'
import { Button } from '../../components/Button/Button.tsx'
import { ProjectCard } from '../../components/ProjectCard/ProjectCard.tsx'
import { useCreateProject, useProjects } from '../../lib/queries.ts'
import './ProjectsView.scss'

export function ProjectsView() {
  const { data: projects, isLoading } = useProjects()
  const create = useCreateProject()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [isClientWork, setIsClientWork] = useState(false)

  const submit = () => {
    if (!name.trim()) return
    create.mutate(
      { name: name.trim(), isClientWork },
      {
        onSuccess: (project) => navigate({ to: '/projects/$slug', params: { slug: project.slug } }),
      }
    )
  }

  return (
    <>
      <ViewHeader
        title="Projects"
        description="Experiments, client work and tools, with their material and posts."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            New project
          </Button>
        }
      />

      {creating ? (
        <form
          className="projects-view__form flex items-center"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <input
            className="projects-view__input flex-1 -p"
            value={name}
            autoFocus
            placeholder="Project name — e.g. Tallinn 3D"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setCreating(false)}
          />
          <label className="projects-view__check flex items-center -p1 shrink-0">
            <input
              type="checkbox"
              checked={isClientWork}
              onChange={(e) => setIsClientWork(e.target.checked)}
            />
            Client work
          </label>
          <Button variant="ghost" onClick={() => setCreating(false)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!name.trim() || create.isPending}>
            Create
          </Button>
        </form>
      ) : null}

      {isLoading ? null : projects?.length ? (
        <div className="projects-view__grid">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      ) : creating ? null : (
        <EmptyState title="No projects yet">
          Create one here, or assign an item from the Inbox — the project picker can create them
          too. Client projects keep AI analysis off until you allow it.
        </EmptyState>
      )}
    </>
  )
}
