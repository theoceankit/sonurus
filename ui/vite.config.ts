import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

const DEV_PORT = 5173

// index.html carries the production CSP. Hot reload also needs the inline
// React Refresh preamble and the dev server's WebSocket, so the dev server
// alone adds them; `vite build` leaves the CSP as written.
function devCsp(): Plugin {
  return {
    name: 'sonorus-dev-csp',
    apply: 'serve',
    transformIndexHtml: html => html
      .replace("default-src 'self';", "default-src 'self'; script-src 'self' 'unsafe-inline';")
      .replace('connect-src ', `connect-src ws://localhost:${DEV_PORT} `),
  }
}

export default defineConfig({
  // Relative asset URLs: the packaged app loads index.html through file://.
  base: './',
  plugins: [react(), devCsp()],
  server: { host: 'localhost', port: DEV_PORT, strictPort: true },
  build: { modulePreload: { polyfill: false } },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test-setup.ts',
    css: { modules: { classNameStrategy: 'non-scoped' } },
  },
})
