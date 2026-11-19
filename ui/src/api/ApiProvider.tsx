import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createContext, useContext, useState, type ReactNode } from 'react'
import type { ApiClient } from './client'

const ApiContext = createContext<ApiClient | null>(null)

// The backend is local, and data changes only through this app and the queue
// events: retrying only delays an error, and a window focus changes nothing.
// Nor does the network of the computer: the backend is on 127.0.0.1, so a
// request is never held back while the window is offline, and nothing is
// refetched when the network comes back. Losing the backend itself is the
// queue socket's business (useQueueEventsSync).
function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { networkMode: 'always', retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false },
      mutations: { networkMode: 'always' },
    },
  })
}

export function ApiProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  const [queryClient] = useState(createQueryClient)
  return (
    <ApiContext.Provider value={client}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ApiContext.Provider>
  )
}

export function useApi(): ApiClient {
  const client = useContext(ApiContext)
  if (!client) throw new Error('useApi needs an ApiProvider around it')
  return client
}
