import type { Asset, Idea } from '@shared/types.ts'
import { ANGLE_LABEL, FORMAT_LABEL, PLATFORM_LABEL } from '../../lib/labels.ts'
import { assetTitle } from '../../lib/format.ts'
import { Button } from '../Button/Button.tsx'
import './IdeaCard.scss'

interface Props {
  idea: Idea
  assets: Map<string, Asset>
  drafting: boolean
  onDraft: () => void
  onStatus: (status: 'saved' | 'dismissed' | 'suggested') => void
}

export function IdeaCard({ idea, assets, drafting, onDraft, onStatus }: Props) {
  const sources = idea.sources.map((s) => assets.get(s.assetId)).filter((a): a is Asset => !!a)

  return (
    <article className="idea-card flex" data-status={idea.status}>
      <div className="idea-card__body flex flex-col flex-1">
        <div className="idea-card__chips flex items-center">
          {idea.angle ? (
            <span className="idea-card__chip -strong -meta">{ANGLE_LABEL[idea.angle]}</span>
          ) : null}
          {idea.format ? (
            <span className="idea-card__chip -meta">{FORMAT_LABEL[idea.format]}</span>
          ) : null}
          {idea.platforms.map((p) => (
            <span key={p} className="idea-card__chip -meta">
              {PLATFORM_LABEL[p]}
            </span>
          ))}
          {idea.status === 'saved' ? <span className="idea-card__saved -meta">Saved</span> : null}
        </div>

        <h2 className="-t2">{idea.title}</h2>
        <p className="-p">{idea.summary}</p>
        <p className="idea-card__rationale -p1">{idea.rationale}</p>

        {idea.questions.length ? (
          <div className="idea-card__questions -p1">
            <span className="-meta">Needs from you</span>
            <ul>
              {idea.questions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="idea-card__actions flex items-center">
          <Button variant="primary" size="s" onClick={onDraft} disabled={drafting}>
            {drafting ? 'Writing drafts…' : 'Write X drafts'}
          </Button>
          {idea.status === 'saved' ? (
            <Button variant="ghost" size="s" onClick={() => onStatus('suggested')}>
              Unsave
            </Button>
          ) : (
            <Button variant="ghost" size="s" onClick={() => onStatus('saved')}>
              Save for later
            </Button>
          )}
          <Button variant="ghost" size="s" onClick={() => onStatus('dismissed')}>
            Dismiss
          </Button>
        </div>
      </div>

      {sources.length ? (
        <div className="idea-card__sources flex flex-col shrink-0">
          <span className="-meta idea-card__muted">Based on</span>
          {sources.map((asset) => (
            <div key={asset.id} className="idea-card__source flex flex-col">
              {asset.thumbUrl ? <img src={asset.thumbUrl} alt="" loading="lazy" /> : null}
              <span className="-meta">{assetTitle(asset)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  )
}
