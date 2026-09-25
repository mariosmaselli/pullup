import { Link, useParams } from '@tanstack/react-router'
import { ViewHeader } from '../../components/ViewHeader/ViewHeader.tsx'
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx'
import { AssetBrowser } from '../../components/AssetBrowser/AssetBrowser.tsx'
import { ProjectPosts } from '../../components/ProjectPosts/ProjectPosts.tsx'
import { Segmented } from '../../components/Segmented/Segmented.tsx'
import { useAssets, useProject, useUpdateProject, type ProjectPatch } from '../../lib/queries.ts'
import type { ProjectStatus } from '@shared/constants.ts'
import './ProjectView.scss'

export function ProjectView() {
  const { slug } = useParams({ from: '/projects/$slug' })
  const { data: project, isLoading, error } = useProject(slug)
  const { data: assets, isLoading: assetsLoading } = useAssets('all', project?.id ?? '')
  const update = useUpdateProject()

  if (isLoading) return null
  if (error || !project) {
    return (
      <EmptyState title="Project not found">
        <Link to="/projects">Back to projects</Link>
      </EmptyState>
    )
  }

  const save = (values: ProjectPatch) => update.mutate({ id: project.id, ...values })

  return (
    <>
      <Link to="/projects" className="project-view__back -meta">
        ← Projects
      </Link>
      <ViewHeader title={project.name} description={project.description || undefined} />

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
      </section>

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
