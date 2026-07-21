import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppNotFound } from './app-not-found'

describe('AppNotFound', () => {
  it('shows an in-app missing route state with a path back to overview', () => {
    render(<AppNotFound />)

    expect(screen.getByText('Route not found')).toBeInTheDocument()
    expect(screen.getByText('This page is not part of the deployment manager.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /projects/i })).toHaveAttribute('href', '/projects')
  })
})
