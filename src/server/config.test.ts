import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// config.ts runs once at import, so each case starts a fresh process.
function loadConfig(env: Record<string, string>) {
  const out = execFileSync(
    'npx',
    [
      'tsx',
      '-e',
      "import('./src/server/config.ts').then(({ config }) => console.log(JSON.stringify({ key: config.anthropicApiKey, source: config.anthropicKeySource })))",
    ],
    { env: { ...process.env, ...env }, encoding: 'utf8' }
  )
  return JSON.parse(out.trim().split('\n').at(-1)!) as { key: string; source: string | null }
}

describe('config: API key source', () => {
  const envFile = join(mkdtempSync(join(tmpdir(), 'pullup-config-')), '.env')
  writeFileSync(envFile, 'ANTHROPIC_API_KEY=sk-ant-from-file\n')

  it('reads the key from .env', () => {
    expect(loadConfig({ PULLUP_ENV_FILE: envFile, ANTHROPIC_API_KEY: '' })).toEqual({
      key: 'sk-ant-from-file',
      source: 'env-file',
    })
  })

  it('lets a real shell export win', () => {
    expect(loadConfig({ PULLUP_ENV_FILE: envFile, ANTHROPIC_API_KEY: 'sk-ant-shell' })).toEqual({
      key: 'sk-ant-shell',
      source: 'environment',
    })
  })

  it('treats an empty or blank shell export as unset', () => {
    expect(loadConfig({ PULLUP_ENV_FILE: envFile, ANTHROPIC_API_KEY: '  ' }).source).toBe(
      'env-file'
    )
  })
})
