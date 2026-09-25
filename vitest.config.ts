import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.ts'],
    // Tests never touch the real library or the real .env (and so never see a real API key).
    env: {
      PULLUP_LIBRARY: join(tmpdir(), `pullup-test-${Date.now()}`),
      PULLUP_ENV_FILE: join(tmpdir(), `pullup-test-${Date.now()}.env`),
      ANTHROPIC_API_KEY: '',
    },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Test files share one throwaway library folder.
    fileParallelism: false,
  },
})
