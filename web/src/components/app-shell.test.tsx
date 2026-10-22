import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { projectPageHandlers } from '../test/fixtures'
import { renderApp } from '../test/render'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const handlers = {
  ...projectPageHandlers(),
  'GET /api/version': { version: '1.2.3', commit_sha: 'abcdef1234567890', build_time: '2026-07-16T00:00:00Z' },
}

it('renders the navigation, page title and build', async () => {
  renderApp('/projects', handlers)

  expect(await screen.findByRole('heading', { name: 'Projects' })).toBeInTheDocument()
  const nav = ['Projects', 'Deployments', 'Servers', 'Notifications', 'Connectors', 'Audit']
  for (const label of nav) {
    expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', `/${label.toLowerCase()}`)
  }
  expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute('data-active', 'true')
  expect(screen.getByRole('link', { name: 'Audit' })).toHaveAttribute('data-active', 'false')
  expect(await screen.findByText('v1.2.3 · abcdef1')).toBeInTheDocument()
})

it('navigates between pages from the sidebar', async () => {
  const { router } = renderApp('/projects', { ...handlers, 'GET /api/audit-events': [] })

  fireEvent.click(await screen.findByRole('link', { name: 'Audit' }))

  expect(await screen.findByRole('heading', { name: 'Audit', level: 1 })).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/audit')
  expect(screen.getByRole('link', { name: 'Audit' })).toHaveAttribute('data-active', 'true')
})

it('collapses and expands the sidebar', async () => {
  renderApp('/projects', handlers)

  fireEvent.click(await screen.findByRole('button', { name: 'Collapse sidebar' }))
  fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
  expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument()
})

it('cycles the theme between light, dark and system', async () => {
  renderApp('/projects', handlers)

  fireEvent.click(await screen.findByRole('button', { name: 'Theme: light. Click to switch.' }))
  expect(document.documentElement).toHaveClass('dark')
  fireEvent.click(screen.getByRole('button', { name: 'Theme: dark. Click to switch.' }))
  fireEvent.click(screen.getByRole('button', { name: 'Theme: system. Click to switch.' }))
  expect(document.documentElement).toHaveClass('light')
  expect(screen.getByRole('button', { name: 'Theme: light. Click to switch.' })).toBeInTheDocument()
  expect(localStorage.getItem('deploy-manager:theme')).toBe('"light"')
})

it('logs out from the account menu', async () => {
  const { requests } = renderApp('/projects', { ...handlers, 'POST /api/logout': () => undefined })

  fireEvent.pointerDown(await screen.findByRole('button', { name: 'Operator account' }), { button: 0, ctrlKey: false })
  const menu = await screen.findByRole('menu')
  expect(within(menu).getByText('user@prosights.co')).toBeInTheDocument()
  fireEvent.click(within(menu).getByRole('menuitem', { name: 'Log Out' }))

  await waitFor(() => expect(requests.some((request) => request.method === 'POST' && request.path === '/api/logout')).toBe(true))
})
