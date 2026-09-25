import { homedir } from 'node:os'
import { resolve } from 'node:path'

try {
  process.loadEnvFile()
} catch {
  // No .env file — rely on the real environment.
}

const expandHome = (path: string) => (path.startsWith('~') ? homedir() + path.slice(1) : path)

const isProduction = process.env.NODE_ENV === 'production'
const basePort = Number(process.env.PORT ?? 4500)

export const config = {
  isProduction,
  // In dev Vite owns PORT and proxies /api to PORT+1. In production one server does both.
  port: isProduction ? basePort : basePort + 1,
  libraryRoot: resolve(expandHome(process.env.PULLUP_LIBRARY ?? '~/Pullup')),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
}
