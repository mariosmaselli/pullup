import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const port = Number(env.PORT ?? 4500)

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@client': fileURLToPath(new URL('./src/client', import.meta.url)),
        '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      },
    },
    server: {
      port,
      strictPort: true,
      proxy: { '/api': `http://localhost:${port + 1}` },
    },
    build: { outDir: 'dist' },
  }
})
