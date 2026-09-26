import { Link } from '@tanstack/react-router'
import type { TemplateMeta } from '@shared/template.ts'
import { ViewHeader } from '../../components/ViewHeader/ViewHeader.tsx'
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx'
import { templateMetas } from '../../render/templates.ts'
import './TemplatesView.scss'

// 'auto' templates render a still or a video depending on the settings (e.g. a JPEG when nothing
// moves).
const KIND_LABEL: Record<TemplateMeta['kind'], string> = {
  still: 'Still',
  video: 'Video',
  auto: 'Still or video',
}

function mediaLabel({ media: { min, max, kinds } }: TemplateMeta) {
  const kind = kinds.join(' or ')
  if (max === 0) return 'Text only'
  if (min === 0) return max === 1 ? `Text, or one ${kind}` : `Up to ${max} ${kind}s`
  return `${min === max ? min : `${min}–${max}`} ${kind}${max === 1 ? '' : 's'}`
}

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
                <span className="templates-view__kind -meta">{KIND_LABEL[meta.kind]}</span>
                <span className="templates-view__aspects -meta">{meta.aspects.join(' · ')}</span>
              </div>
              <h2 className="-t2">{meta.name}</h2>
              <p className="templates-view__description -p1">{meta.description}</p>
              <span className="templates-view__media -meta">{mediaLabel(meta)}</span>
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
