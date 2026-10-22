import { screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { renderApp } from './render'

it('renders a real route with stubbed HTTP', async () => {
  const { requests } = renderApp('/audit', {
    'GET /api/audit-events': [{ id: 1, actor: 'ali', action: 'project.create', target_type: 'project', target_id: 'p1', target_name: 'Billing', metadata: { slug: 'billing' }, created_at: '2026-07-01T12:00:00Z' }],
  })
  expect(await screen.findByText('Billing', {}, { timeout: 3000 })).toBeInTheDocument()
  expect(requests.map((request) => `${request.method} ${request.path}`)).toContain('GET /api/audit-events')
})

it('redirects to login when signed out', async () => {
  const { router } = renderApp('/projects', { 'GET /api/session': { authenticated: false } })
  await screen.findByLabelText('API token')
  expect(router.state.location.pathname).toBe('/login')
})
