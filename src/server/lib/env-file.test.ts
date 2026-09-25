import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { setEnvValue } from './env-file.ts'

const file = () => join(mkdtempSync(join(tmpdir(), 'pullup-env-')), '.env')

describe('setEnvValue', () => {
  it('replaces the key in place, collapses duplicates and keeps other lines', async () => {
    const path = file()
    writeFileSync(
      path,
      '# Library\nPULLUP_LIBRARY=~/Pullup\n\n# AI\nANTHROPIC_API_KEY=\nPORT=4500\nANTHROPIC_API_KEY=old\n'
    )
    await setEnvValue(path, 'ANTHROPIC_API_KEY', 'sk-ant-new')
    expect(readFileSync(path, 'utf8')).toBe(
      '# Library\nPULLUP_LIBRARY=~/Pullup\n\n# AI\nANTHROPIC_API_KEY=sk-ant-new\nPORT=4500\n'
    )
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('removes the key and creates missing files', async () => {
    const path = file()
    await setEnvValue(path, 'ANTHROPIC_API_KEY', 'sk-ant-x')
    expect(readFileSync(path, 'utf8')).toBe('ANTHROPIC_API_KEY=sk-ant-x\n')
    await setEnvValue(path, 'ANTHROPIC_API_KEY', null)
    expect(readFileSync(path, 'utf8')).toBe('\n')
  })

  it('refuses values that would inject extra lines', async () => {
    await expect(setEnvValue(file(), 'ANTHROPIC_API_KEY', 'a\nPORT=1')).rejects.toThrow()
  })
})
