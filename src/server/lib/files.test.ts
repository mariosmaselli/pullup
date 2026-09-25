import { describe, expect, it } from 'vitest'
import { kindFromMime, mediaFileName, resolveMime } from './files.ts'

describe('files', () => {
  it('builds readable, unique media file names', () => {
    expect(mediaFileName('Screen Recording 2026-09-25 at 14.02.11.mov', 'abcdef12-3456')).toBe(
      'screen-recording-2026-09-25-at-14-02-11-abcdef12.mov'
    )
    expect(mediaFileName('Ñandú.PNG', '00000000-1')).toBe('nandu-00000000.png')
    expect(mediaFileName('!!!.png', '11111111-1')).toBe('file-11111111.png')
  })

  it('trusts the extension over a generic browser type', () => {
    expect(resolveMime('clip.mov', 'application/octet-stream')).toBe('video/quicktime')
    expect(resolveMime('pasted', 'image/png')).toBe('image/png')
    expect(resolveMime('brief.pdf', 'video/quicktime')).toBeNull()
    expect(resolveMime('notes.pdf', 'application/pdf')).toBeNull()
    expect(kindFromMime('video/mp4')).toBe('video')
    expect(kindFromMime('text/plain')).toBeNull()
  })
})
