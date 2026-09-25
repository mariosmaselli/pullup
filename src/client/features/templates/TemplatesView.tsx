import { Link } from '@tanstack/react-router'
import { ViewHeader } from '../../components/ViewHeader/ViewHeader.tsx'
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx'
import { templateMetas } from '../../render/templates.ts'
import './TemplatesView.scss'

export function TemplatesView() {
  return (
    <>
      <ViewHeader
        title="Templates"
        description="Story frames, carousel slides and videos rendered from your material. Each template is a folder in pullup/templates/ — WebGL, Three.js, GSAP or canvas 2D."
      />
      {templateMetas.length ? (
        <div className="templates-view__grid">
          {templateMetas.map((meta) => (
            <Link
              key={meta.id}
              to="/templates/$id"
              params={{ id: meta.id }}
              className="templates-view__card flex flex-col"
            >
              <div className="flex items-center justify-between">
                <span className="templates-view__kind -meta">
                  {meta.kind === 'video' ? 'Video' : 'Still'}
                </span>
                <span className="templates-view__aspects -meta">{meta.aspects.join(' · ')}</span>
              </div>
              <h2 className="-t2">{meta.name}</h2>
              <p className="templates-view__description -p1">{meta.description}</p>
              <span className="templates-view__media -meta">
                {meta.media.max === 0
                  ? 'Text only'
                  : `${meta.media.min === meta.media.max ? meta.media.min : `${meta.media.min}–${meta.media.max}`} ${meta.media.kinds.join(' or ')}${meta.media.max === 1 ? '' : 's'}`}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState title="No templates yet">
          Add a folder to pullup/templates/ with a meta.ts and an index.ts.
        </EmptyState>
      )}
    </>
  )
}
