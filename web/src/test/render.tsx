import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { render } from '@testing-library/react'
import { vi } from 'vitest'
import { createQueryClient } from '../lib/query-client'
import { createAppRouter } from '../router'

// A stubbed response: a JSON value, or a function of the request that returns
// one. Throwing an HttpError from a function sends that status.
type Handler = unknown | ((request: StubRequest) => unknown)
export type StubRequest = { method: string, path: string, url: URL, body: unknown }

export class HttpError {
  constructor(readonly status: number, readonly message: string) {}
}

// Render the real app router at `path`, answering HTTP requests from
// `handlers`, keyed by "METHOD /path" (the query string is ignored unless the
// key includes one). Every request is recorded in `requests`.
export function renderApp(path: string, handlers: Record<string, Handler> = {}) {
  const requests: StubRequest[] = []
  const routes: Record<string, Handler> = {
    'GET /api/session': { authenticated: true },
    'GET /api/version': { version: 'dev', commit_sha: '', build_time: '' },
    ...handlers,
  }

  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    const request = { method, path: url.pathname, url, body }
    requests.push(request)
    const handler = routes[`${method} ${url.pathname}${url.search}`] ?? routes[`${method} ${url.pathname}`]
    if (handler === undefined) return json({ error: `no stub for ${method} ${url.pathname}` }, 404)
    try {
      return json(typeof handler === 'function' ? await handler(request) : handler)
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status)
      throw error
    }
  }))

  const queryClient = createQueryClient()
  queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false } })
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }))
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { ...view, router, queryClient, requests }
}

function json(value: unknown, status = 200) {
  return new Response(value === undefined ? null : JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}
