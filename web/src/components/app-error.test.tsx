import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppError } from './app-error'

describe('AppError', () => {
  it('shows operational load failures and lets the router reset', () => {
    const reset = vi.fn()

    render(<AppError error={new Error('database unavailable')} reset={reset} />)

    expect(screen.getByText('Deploy Manager could not load')).toBeInTheDocument()
    expect(screen.getByText('database unavailable')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /retry/i }))

    expect(reset).toHaveBeenCalledTimes(1)
  })
})
