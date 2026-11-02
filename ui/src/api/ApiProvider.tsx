import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createContext, useContext, useState, type ReactNode } from 'react'
import type { ApiClient } from './client'

const ApiContext = createContext<ApiClient | null>(null)

// The backend is local, and data changes only through this app and the queue
// events: retrying only delays an error, and a window focus changes nothing.
function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
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
