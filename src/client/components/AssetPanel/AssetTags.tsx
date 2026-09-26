import { useEffect, useId, useState } from 'react'
import { useAssetTags } from '../../lib/queries.ts'
import './AssetTags.scss'

interface Props {
  tags: string[]
  onChange: (tags: string[]) => void
}

const has = (tags: string[], tag: string) => tags.some((t) => t.toLowerCase() === tag.toLowerCase())

// Tag chips with an input: Enter or comma adds, × or Backspace on an empty input removes.
export function AssetTags({ tags: saved, onChange }: Props) {
  const { data: known = [] } = useAssetTags()
  const [draft, setDraft] = useState('')
  // Edits apply here at once, so quick successive adds never build on a list still being saved.
  const [tags, setTags] = useState(saved)
  const savedKey = JSON.stringify(saved)
  useEffect(() => setTags(JSON.parse(savedKey) as string[]), [savedKey])
  const listId = useId()

  const change = (next: string[]) => {
    setTags(next)
    onChange(next)
  }

  const add = (value: string) => {
    const tag = value.trim().replace(/\s+/g, ' ').slice(0, 40)
    setDraft('')
    if (tag && !has(tags, tag)) change([...tags, tag])
  }

  return (
    <div className="asset-tags flex flex-col">
      <span className="asset-tags__label -meta">Tags</span>
      <div className="asset-tags__box flex items-center">
        {tags.map((tag) => (
          <span key={tag} className="asset-tags__tag flex items-center -p1">
            {tag}
            <button
              type="button"
              className="asset-tags__remove"
              aria-label={`Remove ${tag}`}
              onClick={() => change(tags.filter((t) => t !== tag))}
            >
              ×
            </button>
          </span>
        ))}
        <input
          className="asset-tags__input flex-1 -p1"
          value={draft}
          list={listId}
          placeholder={tags.length ? 'Add…' : 'Add a tag — Enter to save'}
          onChange={(e) => {
            const value = e.target.value
            if (value.endsWith(',')) add(value.slice(0, -1))
            else setDraft(value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add(draft)
            }
            if (e.key === 'Backspace' && !draft && tags.length) change(tags.slice(0, -1))
          }}
          onBlur={() => draft.trim() && add(draft)}
        />
        <datalist id={listId}>
          {known
            .filter((t) => !has(tags, t.tag))
            .map((t) => (
              <option key={t.tag} value={t.tag} />
            ))}
        </datalist>
      </div>
    </div>
  )
}
