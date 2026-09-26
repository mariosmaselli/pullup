import { useEffect, useRef, useState } from 'react'
import { useLocation } from '@tanstack/react-router'
import { useCapture } from '../../lib/capture.tsx'
import { useProjects } from '../../lib/queries.ts'
import { DropOverlay } from '../DropOverlay/DropOverlay.tsx'
import { QuickCapture } from '../QuickCapture/QuickCapture.tsx'
import { CaptureTray } from '../CaptureTray/CaptureTray.tsx'

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

const carriesCapture = (e: DragEvent) =>
  !!e.dataTransfer &&
  (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('text/uri-list'))

// The project page being viewed, if any: captures made there start in that project.
function useViewedProject() {
  const slug = useLocation({
    select: (l) => /^\/projects\/([^/]+)\/?$/.exec(l.pathname)?.[1] ?? null,
  })
  const { data: projects } = useProjects()
  return slug ? (projects?.find((p) => p.slug === decodeURIComponent(slug)) ?? null) : null
}

// App-wide capture: drop files or links anywhere, paste anywhere, ⌘K for quick capture.
export function GlobalCapture() {
  const { uploadFiles, captureText, setQuickCaptureOpen, setCaptureProjectId } = useCapture()
  const project = useViewedProject()
  const [dragging, setDragging] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // Drags that start inside Pullup (e.g. an image in the panel) are not captures.
  const internalDrag = useRef(false)

  useEffect(() => setCaptureProjectId(project?.id ?? null), [project?.id, setCaptureProjectId])

  useEffect(() => {
    const isCapture = (e: DragEvent) => !internalDrag.current && carriesCapture(e)

    // dragover fires continuously while hovering; when it stops (drop, cancel, leaving the
    // window) the overlay hides itself — sturdier than counting enter/leave pairs.
    const onDragOver = (e: DragEvent) => {
      if (!isCapture(e)) return
      e.preventDefault()
      setDragging(true)
      clearTimeout(hideTimer.current)
      hideTimer.current = setTimeout(() => setDragging(false), 150)
    }
    const onDragStart = () => (internalDrag.current = true)
    const onDragEnd = () => (internalDrag.current = false)

    const onDrop = (e: DragEvent) => {
      if (!isCapture(e)) return
      e.preventDefault()
      clearTimeout(hideTimer.current)
      setDragging(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length) return uploadFiles(files, 'drop')
      const url = e.dataTransfer
        ?.getData('text/uri-list')
        .split('\n')
        .find((l) => l && !l.startsWith('#'))
      if (url) void captureText(url, 'url')
    }

    const onPaste = (e: ClipboardEvent) => {
      if (isEditable(e.target)) return
      const files = Array.from(e.clipboardData?.files ?? [])
      if (files.length) {
        e.preventDefault()
        return uploadFiles(files, 'paste')
      }
      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (text.trim()) {
        e.preventDefault()
        void captureText(text, 'paste')
      }
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setQuickCaptureOpen(true)
      }
    }

    window.addEventListener('dragstart', onDragStart)
    window.addEventListener('dragend', onDragEnd)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    window.addEventListener('paste', onPaste)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      clearTimeout(hideTimer.current)
      window.removeEventListener('dragstart', onDragStart)
      window.removeEventListener('dragend', onDragEnd)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [uploadFiles, captureText, setQuickCaptureOpen])

  return (
    <>
      <DropOverlay visible={dragging} projectName={project?.name ?? null} />
      <QuickCapture projectName={project?.name ?? null} />
      <CaptureTray />
    </>
  )
}
