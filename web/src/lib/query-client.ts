import { MutationCache, QueryClient } from '@tanstack/react-query'

export function createQueryClient() {
  const queryClient: QueryClient = new QueryClient({
    // Any successful write refetches every query on screen (and marks the rest
    // stale), so mutations never need to know which queries they affect.
    mutationCache: new MutationCache({
      onSuccess: () => queryClient.invalidateQueries(),
    }),
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
  return queryClient
}

export const queryClient = createQueryClient()
