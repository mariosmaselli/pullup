import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import type { Project } from '@shared/types.ts'
import { ViewHeader } from '../../components/ViewHeader/ViewHeader.tsx'
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx'
import { AssetBrowser } from '../../components/AssetBrowser/AssetBrowser.tsx'
import { Button } from '../../components/Button/Button.tsx'
import { ProjectPosts } from '../../components/ProjectPosts/ProjectPosts.tsx'
import { Segmented } from '../../components/Segmented/Segmented.tsx'
import {
  useAssets,
  useProject,
  useSystem,
  useUpdateProject,
  type ProjectPatch,
} from '../../lib/queries.ts'
import type { ProjectStatus } from '@shared/constants.ts'
import { ProjectDetailsForm } from './ProjectDetailsForm.tsx'
import { ProjectIdeas } from './ProjectIdeas.tsx'
import './ProjectView.scss'

export function ProjectView() {
  const { slug } = useParams({ from: '/projects/$slug' })
  const { data: project, isLoading, error } = useProject(slug)
  const { data: assets, isLoading: assetsLoading } = useAssets('all', project?.id ?? '')
  // The ideas panel depends on whether AI is set up: wait for it so it doesn't change after showing.
  const { data: system } = useSystem()
  const update = useUpdateProject()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)

  if (isLoading || !system) return null
  if (error || !project) {
    return (
      <EmptyState title="Project not found">
        <Link to="/projects">Back to projects</Link>
      </EmptyState>
    )
  }

  const save = (values: ProjectPatch) => update.mutate({ id: project.id, ...values })

  // A rename changes the slug: move to the new address without a "not found" in between.
  const doneEditing = (saved?: Project) => {
    setEditing(false)
    if (saved && saved.slug !== slug) {
      queryClient.setQueryData(['projects', saved.slug], saved)
      navigate({ to: '/projects/$slug', params: { slug: saved.slug }, replace: true })
    }
  }

  return (
    <>
      <Link to="/projects" className="project-view__back -meta">
        ← Projects
      </Link>
      {editing ? (
        <ProjectDetailsForm project={project} onDone={doneEditing} />
      ) : (
        <ViewHeader
          title={project.name}
          description={project.description || undefined}
          actions={
            <Button variant="ghost" onClick={() => setEditing(true)}>
              Edit details
            </Button>
          }
        />
      )}

      <section className="project-view__settings flex items-end">
        <div className="project-view__setting flex flex-col">
          <span className="project-view__label -meta">Status</span>
          <Segmented<ProjectStatus>
            label="Status"
            value={project.status}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'paused', label: 'Paused' },
              { value: 'done', label: 'Done' },
              { value: 'archived', label: 'Archived' },
            ]}
            onChange={(status) => save({ status })}
          />
        </div>
        <div className="project-view__setting flex flex-col">
          <span className="project-view__label -meta">Type</span>
          <Segmented
            label="Type"
            value={project.isClientWork ? 'client' : 'own'}
            options={[
              { value: 'own', label: 'Own work' },
              { value: 'client', label: 'Client work' },
            ]}
            // Becoming client work turns AI off (server side); it can be allowed again below.
            onChange={(v) => save({ isClientWork: v === 'client' })}
          />
        </div>
        <div className="project-view__setting flex flex-col">
          <span className="project-view__label -meta">AI analysis</span>
          <Segmented
            label="AI analysis"
            value={project.aiAllowed ? 'on' : 'off'}
            options={[
              { value: 'on', label: 'Allowed' },
              { value: 'off', label: 'Off' },
            ]}
            onChange={(v) => save({ aiAllowed: v === 'on' })}
          />
        </div>
        <div className="project-view__setting flex flex-col">
          <span className="project-view__label -meta">Tags</span>
          <div className="project-view__tags flex items-center">
            {project.tags.length ? (
              project.tags.map((tag) => (
                <span key={tag} className="project-view__tag -p1">
                  {tag}
                </span>
              ))
            ) : (
              <button
                type="button"
                className="project-view__add -p1"
                onClick={() => setEditing(true)}
              >
                Add tags
              </button>
            )}
          </div>
        </div>
        {project.isClientWork ? (
          <p className="project-view__note w-full -p1">
            {project.aiAllowed
              ? 'Client work with AI allowed: its material is sent to the AI provider when you ask for ideas or drafts.'
              : 'Client work: AI is off, so nothing from this project is sent to the AI. Ideas and drafts you write by hand still work.'}
          </p>
        ) : null}
      </section>

      <ProjectIdeas
        project={project}
        readyCount={(assets ?? []).filter((a) => a.processingStatus === 'ready').length}
      />

      <ProjectPosts projectId={project.id} />

      <AssetBrowser
        assets={assets}
        isLoading={assetsLoading}
        empty={
          <EmptyState title="No material yet">
            Open an item in the Inbox and pick “{project.name}” as its project.
          </EmptyState>
        }
      />
    </>
  )
}
