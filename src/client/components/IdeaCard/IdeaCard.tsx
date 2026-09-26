import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { PLATFORMS, type Platform } from '@shared/constants.ts'
import { PLATFORMS as PLATFORM_CONFIG } from '../../lib/platforms.ts'
import type { Asset, Idea } from '@shared/types.ts'
import { ANGLE_LABEL, FORMAT_LABEL, PLATFORM_LABEL, STATUS_LABEL } from '../../lib/labels.ts'
import { assetTitle } from '../../lib/format.ts'
import { Button } from '../Button/Button.tsx'
import './IdeaCard.scss'

interface Props {
  idea: Idea
  assets: Map<string, Asset>
  drafting: boolean
  error?: string | null
  // Why the AI can't write this idea's drafts (AI not set up, or a project with AI off).
  aiBlocked?: string | null
  onDraft: (platforms: Platform[], instruction: string) => void
  // Blank drafts linked to the idea, written by hand (no AI).
  onWriteByHand: (platforms: Platform[]) => void
  onStatus: (status: 'saved' | 'dismissed' | 'suggested') => void
  onAnswers: (answers: string[]) => void
}

const DEFAULT_PLATFORMS: Platform[] = ['x', 'linkedin', 'ig_story']

const list = (items: string[]) =>
  items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : (items[0] ?? '')

export function IdeaCard(props: Props) {
  const { idea, assets, drafting, error, aiBlocked, onStatus } = props
  // Start from where the idea fits; Mario toggles from there.
  const [platforms, setPlatforms] = useState<Platform[]>(
    idea.platforms.length ? idea.platforms : DEFAULT_PLATFORMS
  )
  const [instruction, setInstruction] = useState('')
  const [answers, setAnswers] = useState(idea.answers)
  // Asking before another full set of drafts: which way they'd be written.
  const [confirming, setConfirming] = useState<'ai' | 'hand' | null>(null)

  const toggle = (p: Platform) =>
    setPlatforms((current) =>
      current.includes(p)
        ? current.filter((x) => x !== p)
        : PLATFORMS.filter((x) => current.includes(x) || x === p)
    )

  const sources = idea.sources.map((s) => assets.get(s.assetId)).filter((a): a is Asset => !!a)
  const alreadyDrafted = [
    ...new Set(idea.drafts.filter((d) => platforms.includes(d.platform)).map((d) => d.platform)),
  ]
  const answered = answers.filter((a) => a.trim()).length

  const write = (how: 'ai' | 'hand', confirmed = false) => {
    if (alreadyDrafted.length && !confirmed) return setConfirming(how)
    setConfirming(null)
    if (how === 'ai') props.onDraft(platforms, instruction.trim())
    else props.onWriteByHand(platforms)
  }

  const saveAnswer = (index: number) => {
    const next = answers.map((a) => a.trim())
    if (next[index] !== (idea.answers[index] ?? '')) props.onAnswers(next)
  }

  return (
    <article className="idea-card flex" data-status={idea.status}>
      <div className="idea-card__body flex flex-col flex-1">
        <div className="idea-card__chips flex items-center">
          {idea.origin === 'manual' ? (
            <span className="idea-card__chip -mine -meta">By you</span>
          ) : null}
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
        {idea.summary ? <p className="-p">{idea.summary}</p> : null}
        {idea.rationale ? <p className="idea-card__rationale -p1">{idea.rationale}</p> : null}

        {idea.questions.length ? (
          <div className="idea-card__questions flex flex-col -p1">
            <span className="-meta">
              Needs from you · {answered} of {idea.questions.length} answered
            </span>
            <ol className="flex flex-col">
              {idea.questions.map((q, i) => (
                <li key={q} className="flex flex-col">
                  <label htmlFor={`${idea.id}-answer-${i}`}>{q}</label>
                  <textarea
                    id={`${idea.id}-answer-${i}`}
                    className="idea-card__answer -p1"
                    rows={1}
                    maxLength={2000}
                    value={answers[i] ?? ''}
                    placeholder="Your answer — used as your own words in the drafts"
                    onChange={(e) =>
                      setAnswers((current) =>
                        idea.questions.map((_, j) =>
                          j === i ? e.target.value : (current[j] ?? '')
                        )
                      )
                    }
                    onBlur={() => saveAnswer(i)}
                  />
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        {idea.drafts.length ? (
          <div className="idea-card__drafts flex items-center">
            <span className="idea-card__muted -meta">Drafts</span>
            {idea.drafts.map((d) => (
              <Link
                key={d.id}
                to="/drafts/$id"
                params={{ id: d.id }}
                className="idea-card__draft -p1"
                data-status={d.status}
              >
                {PLATFORM_LABEL[d.platform]} · {STATUS_LABEL[d.status]}
              </Link>
            ))}
          </div>
        ) : null}

        <div className="idea-card__platforms flex items-center" role="group" aria-label="Platforms">
          {PLATFORMS.map((p) => (
            <button
              key={p}
              type="button"
              className="idea-card__platform -p1"
              aria-pressed={platforms.includes(p)}
              disabled={drafting}
              onClick={() => {
                setConfirming(null)
                toggle(p)
              }}
            >
              {PLATFORM_CONFIG[p].label}
            </button>
          ))}
        </div>

        {aiBlocked ? null : (
          <textarea
            className="idea-card__direction -p1"
            rows={1}
            maxLength={2000}
            value={instruction}
            disabled={drafting}
            aria-label="Direction for the drafts"
            placeholder="Direction for the drafts (optional) — e.g. keep it short, focus on the shader"
            onChange={(e) => setInstruction(e.target.value)}
          />
        )}

        <div className="idea-card__actions flex items-center">
          {confirming ? (
            <>
              <span className="idea-card__confirm -p1">
                {list(alreadyDrafted.map((p) => PLATFORM_LABEL[p]))} already{' '}
                {alreadyDrafted.length === 1 ? 'has a draft' : 'have drafts'} from this idea.
              </span>
              <Button variant="primary" size="s" onClick={() => write(confirming, true)}>
                Write another set
              </Button>
              <Button variant="ghost" size="s" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              {aiBlocked ? null : (
                <Button
                  variant="primary"
                  size="s"
                  onClick={() => write('ai')}
                  disabled={drafting || !platforms.length}
                >
                  {drafting
                    ? 'Writing drafts…'
                    : `Write ${platforms.length} draft${platforms.length === 1 ? '' : 's'}`}
                </Button>
              )}
              <Button
                variant={aiBlocked ? 'primary' : 'ghost'}
                size="s"
                onClick={() => write('hand')}
                disabled={drafting || !platforms.length}
              >
                Write by hand
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
            </>
          )}
        </div>

        {aiBlocked ? <p className="idea-card__muted -p1">{aiBlocked}</p> : null}
        {error ? (
          <p className="idea-card__error -p1" role="alert">
            {error}
          </p>
        ) : null}
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
