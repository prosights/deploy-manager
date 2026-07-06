import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      // Keep cached page data for 30 minutes so returning to a page after
      // idle renders instantly instead of suspending on a refetch.
      gcTime: 30 * 60_000,
      retry: 1,
    },
  },
})
