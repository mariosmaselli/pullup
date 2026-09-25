import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const port = Number(env.PORT ?? 4500)

  return {
    plugins: [react(), tailwindcss()],
    // The client reads no env vars. Without this Vite restarts (reloading the page) whenever
    // Settings saves the API key to .env.
    envDir: false as const,
    resolve: {
      alias: {
        '@client': fileURLToPath(new URL('./src/client', import.meta.url)),
        '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      },
    },
    server: {
      port,
      strictPort: true,
      // Everything is same-origin; Vite's default CORS would let other localhost pages read /api.
      cors: false,
      proxy: { '/api': `http://localhost:${port + 1}` },
    },
    build: { outDir: 'dist' },
  }
})
