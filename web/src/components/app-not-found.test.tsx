import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { projectPageHandlers } from '../test/fixtures'
import { renderApp } from '../test/render'

afterEach(cleanup)

it('shows a missing route state with a link back to projects', async () => {
  const { router } = renderApp('/nowhere', projectPageHandlers())

  expect(await screen.findByText('Route not found')).toBeInTheDocument()
  expect(screen.getByText('This page is not part of the deployment manager.')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('link', { name: 'Projects' }))

  expect(await screen.findByRole('link', { name: 'Open project Billing' })).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/projects')
})
