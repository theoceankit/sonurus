import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ApiProvider } from './api/ApiProvider'
import { createBackendClient } from './api/backend-client'
import type { ApiClient } from './api/client'
import { App } from './App'
import './styles/index.css'

// VITE_SONORUS_FIXTURES=1 npm run dev:ui shows the screens on fixtures in the
// app. A build has no DEV, so the branch and the fixtures are left out of it.
async function createClient(): Promise<ApiClient> {
  if (import.meta.env.DEV && import.meta.env.VITE_SONORUS_FIXTURES) {
    const { createFixtureClient } = await import('./api/fixtures/fixture-client')
    return createFixtureClient()
  }
  return createBackendClient()
}

createClient().then(client => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ApiProvider client={client}>
        <App />
      </ApiProvider>
    </StrictMode>,
  )
})
