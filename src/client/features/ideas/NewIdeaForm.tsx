import { useMemo, useState, type ReactNode } from 'react'
import { ANGLES, PLATFORMS, type Angle, type Platform } from '@shared/constants.ts'
import type { Idea } from '@shared/types.ts'
import { Button } from '../../components/Button/Button.tsx'
import { ProjectPicker } from '../../components/ProjectPicker/ProjectPicker.tsx'
import { Segmented } from '../../components/Segmented/Segmented.tsx'
import { ANGLE_LABEL, FORMAT_LABEL, PLATFORM_LABEL } from '../../lib/labels.ts'
import { useAssets, useCreateIdea, type NewIdeaInput } from '../../lib/queries.ts'
import { SourcePicker } from './SourcePicker.tsx'
import './NewIdeaForm.scss'

type Format = NonNullable<NewIdeaInput['format']>
const FORMATS: Format[] = ['single', 'thread', 'story_seq', 'carousel']
const MAX_SOURCES = 12

interface Props {
  // Preselected project (the project page).
  projectId?: string | null
  onCreated: (idea: Idea) => void
  onCancel: () => void
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="new-idea-form__field flex flex-col">
      <span className="new-idea-form__label -meta">{label}</span>
      {children}
    </div>
  )
}

// One-choice chips; clicking the chosen one clears it.
function Choice<T extends string>(props: {
  label: string
  options: T[]
  labels: Record<T, string>
  value: T | null
  onChange: (value: T | null) => void
}) {
  return (
    <div
      className="new-idea-form__chips flex items-center"
      role="radiogroup"
      aria-label={props.label}
    >
      {props.options.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={props.value === option}
          className="new-idea-form__chip -p1"
          onClick={() => props.onChange(props.value === option ? null : option)}
        >
          {props.labels[option]}
        </button>
      ))}
    </div>
  )
}

// An idea Mario writes himself: nothing is sent to the AI, so it works for client work with AI
// off. Its title and summary count as his own words when drafts are written from it.
export function NewIdeaForm({ projectId = null, onCreated, onCancel }: Props) {
  const create = useCreateIdea()
  const { data: assets = [] } = useAssets('all')
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [angle, setAngle] = useState<Angle | null>(null)
  const [format, setFormat] = useState<Format | null>(null)
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [project, setProject] = useState<string | null>(projectId)
  const [scope, setScope] = useState<'project' | 'all'>(projectId ? 'project' : 'all')
  const [sources, setSources] = useState<string[]>([])

  const pickable = useMemo(
    () => (project && scope === 'project' ? assets.filter((a) => a.projectId === project) : assets),
    [assets, project, scope]
  )
  const togglePlatform = (p: Platform) =>
    setPlatforms((current) =>
      current.includes(p)
        ? current.filter((x) => x !== p)
        : PLATFORMS.filter((x) => current.includes(x) || x === p)
    )

  const submit = () => {
    if (!title.trim() || create.isPending) return
    create.mutate(
      {
        title: title.trim(),
        summary: summary.trim() || undefined,
        angle,
        format,
        platforms,
        assetIds: sources,
        projectId: project,
      },
      { onSuccess: onCreated }
    )
  }

  return (
    <form
      className="new-idea-form flex flex-col"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div className="flex items-baseline justify-between">
        <h2 className="-t2">New idea</h2>
        <span className="new-idea-form__muted -meta">Your own words · no AI</span>
      </div>

      <input
        className="new-idea-form__input -p"
        value={title}
        autoFocus
        maxLength={200}
        placeholder="Working title — e.g. How the harbor map legend works"
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        className="new-idea-form__input new-idea-form__summary -p"
        value={summary}
        rows={3}
        maxLength={4000}
        placeholder="What the post would say or show, and anything the drafts should know"
        onChange={(e) => setSummary(e.target.value)}
      />

      <div className="new-idea-form__grid">
        <Field label="Angle">
          <Choice
            label="Angle"
            options={[...ANGLES]}
            labels={ANGLE_LABEL}
            value={angle}
            onChange={setAngle}
          />
        </Field>
        <Field label="Format">
          <Choice
            label="Format"
            options={FORMATS}
            labels={FORMAT_LABEL}
            value={format}
            onChange={setFormat}
          />
        </Field>
        <Field label="Platforms">
          <div
            className="new-idea-form__chips flex items-center"
            role="group"
            aria-label="Platforms"
          >
            {PLATFORMS.map((p) => (
              <button
                key={p}
                type="button"
                className="new-idea-form__chip -p1"
                aria-pressed={platforms.includes(p)}
                onClick={() => togglePlatform(p)}
              >
                {PLATFORM_LABEL[p]}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Project">
          <div className="new-idea-form__project">
            <ProjectPicker value={project} onChange={setProject} />
          </div>
        </Field>
      </div>

      <Field
        label={`Based on${sources.length ? ` · ${sources.length} selected` : ''} (up to ${MAX_SOURCES})`}
      >
        {project ? (
          <div className="new-idea-form__scope">
            <Segmented
              label="Show material from"
              value={scope}
              options={[
                { value: 'project', label: 'This project' },
                { value: 'all', label: 'Whole library' },
              ]}
              onChange={setScope}
            />
          </div>
        ) : null}
        <SourcePicker
          assets={pickable}
          selected={sources}
          max={MAX_SOURCES}
          onChange={setSources}
        />
      </Field>

      <div className="new-idea-form__actions flex items-center justify-end">
        {create.error ? (
          <p className="new-idea-form__error -p1 flex-1" role="alert">
            {create.error.message}
          </p>
        ) : null}
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={!title.trim() || create.isPending}>
          {create.isPending ? 'Saving…' : 'Create idea'}
        </Button>
      </div>
    </form>
  )
}
