import { useEffect, useRef, useState } from 'react'
import { useCapture } from '../../lib/capture.tsx'
import { isUrl } from '../../lib/format.ts'
import { Button } from '../Button/Button.tsx'
import './QuickCapture.scss'

// ⌘K dialog: type a note or paste a link; Enter saves.
export function QuickCapture() {
  const { quickCaptureOpen, setQuickCaptureOpen, captureText, uploadFiles } = useCapture()
  const dialog = useRef<HTMLDialogElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')

  useEffect(() => {
    const el = dialog.current
    if (!el) return
    if (quickCaptureOpen && !el.open) el.showModal()
    if (!quickCaptureOpen && el.open) el.close()
  }, [quickCaptureOpen])

  const close = () => setQuickCaptureOpen(false)

  const save = () => {
    if (!text.trim()) return
    void captureText(text)
    setText('')
    close()
  }

  const onFiles = (files: FileList | null) => {
    if (files?.length) uploadFiles(Array.from(files), 'drop')
    if (fileInput.current) fileInput.current.value = ''
    close()
  }

  const kind = isUrl(text) ? 'Link' : 'Note'

  return (
    <dialog
      ref={dialog}
      className="quick-capture"
      onClose={close}
      onClick={(e) => e.target === dialog.current && close()}
    >
      <div className="quick-capture__body flex flex-col">
        <textarea
          className="quick-capture__input -p"
          value={text}
          autoFocus
          rows={4}
          placeholder="Write a note, an idea for a post, or paste a link…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              save()
            }
          }}
        />
        <div className="quick-capture__footer flex items-center justify-between">
          <span className="quick-capture__hint -meta">
            {text.trim() ? `Saves as ${kind}` : 'Enter to save · Shift+Enter for a new line'}
          </span>
          <div className="flex items-center">
            <Button variant="ghost" size="s" onClick={() => fileInput.current?.click()}>
              Add files
            </Button>
            <Button variant="primary" size="s" onClick={save} disabled={!text.trim()}>
              Save
            </Button>
          </div>
        </div>
      </div>
      <input
        ref={fileInput}
        type="file"
        multiple
        accept="image/*,video/*,.heic,.mov,.mkv"
        hidden
        onChange={(e) => onFiles(e.target.files)}
      />
    </dialog>
  )
}
