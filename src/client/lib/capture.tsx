import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import type { AssetSource } from '@shared/constants.ts'
import type { CaptureResult } from '@shared/types.ts'
import { api } from './api.ts'
import { isUrl } from './format.ts'
import { useInvalidateAssets } from './queries.ts'

export interface Activity {
  id: string
  label: string
  kind: 'upload' | 'link' | 'note'
  status: 'queued' | 'uploading' | 'done' | 'duplicate' | 'error'
  progress: number // 0–1
  error?: string
  // A PDF became this many page images.
  pages?: number
  // Worth reading before it fades (e.g. a PDF over the page limit).
  message?: string
}

interface CaptureApi {
  activities: Activity[]
  uploadFiles: (files: File[], source?: AssetSource) => void
  captureText: (text: string, source?: AssetSource) => Promise<void>
  dismiss: (id: string) => void
  quickCaptureOpen: boolean
  setQuickCaptureOpen: (open: boolean) => void
  // The project being viewed: captures made there start in it (set by GlobalCapture).
  captureProjectId: string | null
  setCaptureProjectId: (id: string | null) => void
}

const CaptureContext = createContext<CaptureApi | null>(null)

const UPLOAD_CONCURRENCY = 2
const DISMISS_AFTER_MS = 4000
const DISMISS_MESSAGE_AFTER_MS = 12_000

// XHR instead of fetch: fetch has no upload progress.
function uploadFile(
  file: File,
  source: AssetSource,
  projectId: string | null,
  onProgress: (p: number) => void
) {
  return new Promise<CaptureResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/assets/upload')
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name || 'pasted'))
    xhr.setRequestHeader('X-Last-Modified', String(file.lastModified))
    xhr.setRequestHeader('X-Source', source)
    if (projectId) xhr.setRequestHeader('X-Project-Id', projectId)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    xhr.onload = () => {
      const body = JSON.parse(xhr.responseText || '{}')
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as CaptureResult)
      else reject(new Error(body.error ?? `Upload failed (${xhr.status})`))
    }
    xhr.onerror = () => reject(new Error('Upload failed — is the server running?'))
    xhr.send(file)
  })
}

export function CaptureProvider({ children }: { children: ReactNode }) {
  const [activities, setActivities] = useState<Activity[]>([])
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false)
  const [captureProjectId, setProjectState] = useState<string | null>(null)
  // Read when a capture starts, so a queued upload keeps the project it was dropped on.
  const projectRef = useRef<string | null>(null)
  const setCaptureProjectId = useCallback((id: string | null) => {
    projectRef.current = id
    setProjectState(id)
  }, [])
  const queue = useRef<
    { activityId: string; file: File; source: AssetSource; projectId: string | null }[]
  >([])
  const active = useRef(0)
  const invalidate = useInvalidateAssets()

  const patch = useCallback((id: string, values: Partial<Activity>) => {
    setActivities((list) => list.map((a) => (a.id === id ? { ...a, ...values } : a)))
  }, [])

  const dismiss = useCallback((id: string) => {
    setActivities((list) => list.filter((a) => a.id !== id))
  }, [])

  const finish = useCallback(
    (id: string, values: Partial<Activity>) => {
      patch(id, { progress: 1, ...values })
      if (values.status !== 'error') {
        setTimeout(() => dismiss(id), values.message ? DISMISS_MESSAGE_AFTER_MS : DISMISS_AFTER_MS)
      }
      invalidate()
    },
    [patch, dismiss, invalidate]
  )

  const pump = useCallback(() => {
    while (active.current < UPLOAD_CONCURRENCY && queue.current.length) {
      const job = queue.current.shift()!
      active.current++
      patch(job.activityId, { status: 'uploading' })
      uploadFile(job.file, job.source, job.projectId, (progress) =>
        patch(job.activityId, { progress })
      )
        .then((result) =>
          finish(job.activityId, {
            status: result.duplicate ? 'duplicate' : 'done',
            pages: result.pages,
            message: result.message,
          })
        )
        .catch((err: Error) => finish(job.activityId, { status: 'error', error: err.message }))
        .finally(() => {
          active.current--
          pump()
        })
    }
  }, [patch, finish])

  const uploadFiles = useCallback(
    (files: File[], source: AssetSource = 'drop') => {
      const projectId = projectRef.current
      const jobs = files.map((file) => ({
        activityId: crypto.randomUUID(),
        file,
        source,
        projectId,
      }))
      setActivities((list) => [
        ...list,
        ...jobs.map<Activity>((job) => ({
          id: job.activityId,
          label: job.file.name || 'Pasted image',
          kind: 'upload',
          status: 'queued',
          progress: 0,
        })),
      ])
      queue.current.push(...jobs)
      pump()
    },
    [pump]
  )

  const captureText = useCallback(
    async (text: string, source?: AssetSource) => {
      const value = text.trim()
      if (!value) return
      const link = isUrl(value)
      const id = crypto.randomUUID()
      const projectId = projectRef.current
      setActivities((list) => [
        ...list,
        {
          id,
          label: link ? value : value.split('\n')[0]!.slice(0, 60),
          kind: link ? 'link' : 'note',
          status: 'uploading',
          progress: 0,
        },
      ])
      try {
        await (link
          ? api<CaptureResult>('/assets/link', {
              method: 'POST',
              body: JSON.stringify({ url: value, source, projectId }),
            })
          : api<CaptureResult>('/assets/note', {
              method: 'POST',
              body: JSON.stringify({ body: value, source, projectId }),
            }))
        finish(id, { status: 'done' })
      } catch (err) {
        finish(id, { status: 'error', error: (err as Error).message })
      }
    },
    [finish]
  )

  return (
    <CaptureContext
      value={{
        activities,
        uploadFiles,
        captureText,
        dismiss,
        quickCaptureOpen,
        setQuickCaptureOpen,
        captureProjectId,
        setCaptureProjectId,
      }}
    >
      {children}
    </CaptureContext>
  )
}

export function useCapture() {
  const ctx = useContext(CaptureContext)
  if (!ctx) throw new Error('useCapture must be used inside <CaptureProvider>')
  return ctx
}
