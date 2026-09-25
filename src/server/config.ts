import { homedir } from 'node:os'
import { resolve } from 'node:path'

// .env lives next to the code (gitignored). PULLUP_ENV_FILE points elsewhere — tests use a
// throwaway file so they never read or write the real one.
const envFile = resolve(process.env.PULLUP_ENV_FILE ?? '.env')

// A key exported in the shell wins over .env (loadEnvFile never overrides existing variables).
// An empty export counts as unset — otherwise it would silently hide the key saved in .env.
const shellKey = process.env.ANTHROPIC_API_KEY?.trim()
if (!shellKey) delete process.env.ANTHROPIC_API_KEY

try {
  process.loadEnvFile(envFile)
} catch {
  // No .env file — rely on the real environment.
}

const expandHome = (path: string) => (path.startsWith('~') ? homedir() + path.slice(1) : path)

const isProduction = process.env.NODE_ENV === 'production'
const basePort = Number(process.env.PORT ?? 4500)
const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim() ?? ''

export const config = {
  isProduction,
  // The port the browser talks to (Vite in dev, this server in production).
  publicPort: basePort,
  // In dev Vite owns PORT and proxies /api to PORT+1. In production one server does both.
  port: isProduction ? basePort : basePort + 1,
  libraryRoot: resolve(expandHome(process.env.PULLUP_LIBRARY ?? '~/Pullup')),
  envFile,
  anthropicApiKey,
  // Where the key came from: the shell environment can't be changed from the app, .env can.
  anthropicKeySource: (shellKey ? 'environment' : anthropicApiKey ? 'env-file' : null) as
    'environment' | 'env-file' | null,
}
