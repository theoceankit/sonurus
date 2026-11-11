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
  // The CSP allows no data: URLs, so fonts stay files however small they are.
  build: { modulePreload: { polyfill: false }, assetsInlineLimit: 0 },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test-setup.ts',
    // Vitest blanks CSS by default, and that includes ?raw imports, which the
    // tests of the tokens and of raw values read.
    css: { include: [/.+/], modules: { classNameStrategy: 'non-scoped' } },
    // The tests that walk the sources use import.meta.glob. A cached transform
    // keeps the old list of files, so they would not see a new file.
    fsModuleCache: false,
    // Vitest's default is one worker fewer than the cores, so a two-core CI
    // runner would run the files one at a time.
    maxWorkers: '100%',
  },
})
