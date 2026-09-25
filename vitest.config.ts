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
    // Tests never touch the real library.
    env: { PULLUP_LIBRARY: join(tmpdir(), `pullup-test-${Date.now()}`) },
    testTimeout: 30_000,
  },
})
