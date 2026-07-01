import type { ReactNode } from 'react'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'

// renderWithRouter-style helper: wraps arbitrary content in a minimal TanStack
// Router context so components using <Link> can render in unit tests without
// pulling in the full application route tree.
export function TestRouter({ children }: { children: ReactNode }) {
  const rootRoute = createRootRoute()
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <>{children}</>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  return <RouterProvider router={router} />
}
