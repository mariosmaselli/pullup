import { useState } from 'react'
import type { Project } from '@shared/types.ts'
import { Button } from '../../components/Button/Button.tsx'
import { useUpdateProject } from '../../lib/queries.ts'
import './ProjectDetailsForm.scss'

const MAX_TAGS = 30
const MAX_TAG = 40

interface Props {
  project: Project
  onDone: (saved?: Project) => void
}

// Name, description and tags. The description and tags are sent to the AI with every ideas and
// drafts request for this project (when its AI is on) — they're Mario's words about the work.
export function ProjectDetailsForm({ project, onDone }: Props) {
  const update = useUpdateProject()
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description)
  const [tags, setTags] = useState(project.tags)
  const [tag, setTag] = useState('')

  const withTag = (current: string[], raw: string) => {
    const value = raw.replace(/,/g, ' ').trim().slice(0, MAX_TAG)
    return value && !current.includes(value) && current.length < MAX_TAGS
      ? [...current, value]
      : current
  }
  const addTag = () => {
    setTags((current) => withTag(current, tag))
    setTag('')
  }

  const submit = () => {
    if (!name.trim() || update.isPending) return
    update.mutate(
      {
        id: project.id,
        name: name.trim(),
        description: description.trim(),
        // A tag still being typed counts.
        tags: withTag(tags, tag),
      },
      { onSuccess: (saved) => onDone(saved) }
    )
  }

  return (
    <form
      className="project-details-form flex flex-col"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <label className="project-details-form__field flex flex-col">
        <span className="project-details-form__label -meta">Name</span>
        <input
          className="project-details-form__input -t2"
          value={name}
          autoFocus
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <label className="project-details-form__field flex flex-col">
        <span className="project-details-form__label -meta">Description</span>
        <textarea
          className="project-details-form__input -p"
          value={description}
          rows={4}
          maxLength={5000}
          placeholder="What it is, who it's for, what's interesting about it. The AI reads this with every idea and draft for this project."
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>

      <div className="project-details-form__field flex flex-col">
        <span className="project-details-form__label -meta">Tags</span>
        <div className="project-details-form__tags flex items-center">
          {tags.map((t) => (
            <span key={t} className="project-details-form__tag flex items-center -p1">
              {t}
              <button
                type="button"
                aria-label={`Remove ${t}`}
                onClick={() => setTags((current) => current.filter((x) => x !== t))}
              >
                ×
              </button>
            </span>
          ))}
          <input
            className="project-details-form__tag-input flex-1 -p1"
            value={tag}
            maxLength={MAX_TAG + 1}
            placeholder={tags.length ? 'Add a tag' : 'webgl, three.js, case study…'}
            onChange={(e) => {
              // A comma finishes a tag.
              const value = e.target.value
              if (!value.endsWith(',')) return setTag(value)
              setTags((current) => withTag(current, value))
              setTag('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && tag.trim()) {
                e.preventDefault()
                addTag()
              }
              if (e.key === 'Backspace' && !tag && tags.length) setTags(tags.slice(0, -1))
            }}
          />
        </div>
      </div>

      <div className="project-details-form__actions flex items-center justify-end">
        {update.error ? (
          <p className="project-details-form__error -p1 flex-1" role="alert">
            {update.error.message}
          </p>
        ) : null}
        <Button variant="ghost" onClick={() => onDone()}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={!name.trim() || update.isPending}>
          {update.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  )
}
