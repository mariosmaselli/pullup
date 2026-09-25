import { useState } from 'react'
import { useCreateProject, useProjects } from '../../lib/queries.ts'
import { Button } from '../Button/Button.tsx'
import './ProjectPicker.scss'

const NEW = '__new__'

interface Props {
  value: string | null
  onChange: (projectId: string | null) => void
}

// Project select with inline "New project…" so assigning never leaves the panel.
export function ProjectPicker({ value, onChange }: Props) {
  const { data: projects = [] } = useProjects()
  const create = useCreateProject()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [isClientWork, setIsClientWork] = useState(false)

  const submit = () => {
    if (!name.trim()) return
    create.mutate(
      { name: name.trim(), isClientWork },
      {
        onSuccess: (project) => {
          onChange(project.id)
          setCreating(false)
          setName('')
          setIsClientWork(false)
        },
      }
    )
  }

  if (creating) {
    return (
      <div className="project-picker__new flex flex-col">
        <input
          className="project-picker__input -p"
          value={name}
          autoFocus
          placeholder="Project name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') {
              e.stopPropagation()
              setCreating(false)
            }
          }}
        />
        <div className="flex items-center justify-between">
          <label className="project-picker__check flex items-center -p1">
            <input
              type="checkbox"
              checked={isClientWork}
              onChange={(e) => setIsClientWork(e.target.checked)}
            />
            Client work <span className="-meta">(AI off until you allow it)</span>
          </label>
          <div className="flex items-center">
            <Button variant="ghost" size="s" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="s" onClick={submit} disabled={!name.trim()}>
              Create
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <select
      className="project-picker__select -p"
      value={value ?? ''}
      onChange={(e) => {
        if (e.target.value === NEW) return setCreating(true)
        onChange(e.target.value || null)
      }}
    >
      <option value="">No project</option>
      {projects.map((project) => (
        <option key={project.id} value={project.id}>
          {project.name}
          {project.isClientWork ? ' · client' : ''}
        </option>
      ))}
      <option value={NEW}>New project…</option>
    </select>
  )
}
