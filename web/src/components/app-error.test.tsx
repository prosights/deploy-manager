import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { AppError } from './app-error'

describe('AppError', () => {
  it('shows operational load failures and lets the router reset', () => {
    const queryClient = new QueryClient()
    const resetQueries = vi.spyOn(queryClient, 'resetQueries')
    const reset = vi.fn()

    render(
      <QueryClientProvider client={queryClient}>
        <AppError error={new Error('database unavailable')} reset={reset} />
      </QueryClientProvider>,
    )

    expect(screen.getByText('Deploy Manager could not load')).toBeInTheDocument()
    expect(screen.getByText('database unavailable')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /retry/i }))

    expect(resetQueries).toHaveBeenCalledTimes(1)
    expect(reset).toHaveBeenCalledTimes(1)
  })
})
