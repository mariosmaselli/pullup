import { Link } from '@tanstack/react-router'
import type { Project } from '@shared/types.ts'
import { relativeTime } from '../../lib/format.ts'
import './ProjectCard.scss'

const STATUS_LABEL: Record<Project['status'], string> = {
  active: 'Active',
  paused: 'Paused',
  done: 'Done',
  archived: 'Archived',
}

export function ProjectCard({ project }: { project: Project }) {
  const cover = project.coverAssetId ? `/api/files/cache/${project.coverAssetId}/thumb.jpg` : null

  return (
    <Link
      to="/projects/$slug"
      params={{ slug: project.slug }}
      className="project-card flex flex-col"
      data-status={project.status}
    >
      <div className="project-card__cover">
        {cover ? (
          <img src={cover} alt="" loading="lazy" />
        ) : (
          <span className="-t2">{project.name.slice(0, 1)}</span>
        )}
      </div>
      <div className="project-card__meta flex flex-col">
        <div className="flex items-center justify-between">
          <span className="project-card__name -p">{project.name}</span>
          {project.isClientWork ? <span className="project-card__tag -meta">Client</span> : null}
        </div>
        <span className="project-card__detail -meta">
          {project.assetCount} item{project.assetCount === 1 ? '' : 's'}
          {project.status !== 'active' ? ` · ${STATUS_LABEL[project.status]}` : ''}
          {project.lastCapturedAt ? ` · ${relativeTime(project.lastCapturedAt)}` : ''}
        </span>
      </div>
    </Link>
  )
}
