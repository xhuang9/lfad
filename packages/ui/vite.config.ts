import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The UI is served in production by the @lfad/runtime daemon (PORT 4319) out
// of this build's `dist/` directory. In `vite dev` we proxy same-origin `/api`
// calls (and the SSE stream) to that daemon so the relative paths just work.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5319,
    proxy: {
      '/api': {
        target: 'http://localhost:4319',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
