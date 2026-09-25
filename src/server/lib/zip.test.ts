import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { zipFiles } from './zip.ts'

describe('zipFiles', () => {
  it('writes an archive that unzip reads back byte for byte', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pullup-zip-'))
    const a = join(dir, 'a.bin')
    writeFileSync(a, Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 251)))
    const zip = await zipFiles(
      [{ path: a, name: '01-frame.mp4' }],
      [{ name: 'caption.txt', content: 'Hej ✨' }]
    )
    const out = join(dir, 'out.zip')
    writeFileSync(out, Buffer.from(zip))
    expect(execFileSync('unzip', ['-t', out]).toString()).toMatch(/No errors detected/)
    execFileSync('unzip', ['-q', out, '-d', join(dir, 'x')])
    expect(execFileSync('cmp', [a, join(dir, 'x', '01-frame.mp4')]).toString()).toBe('')
    expect(execFileSync('cat', [join(dir, 'x', 'caption.txt')]).toString()).toBe('Hej ✨')
  })
})
