import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { ConnectorAccount } from '../lib/api'
import { githubRepository, githubStatus, registry } from '../test/fixtures'
import { HttpError, renderApp } from '../test/render'

afterEach(cleanup)

const githubConnector: ConnectorAccount = {
  id: 'connector_github',
  provider: 'github',
  name: 'GitHub',
  enabled: true,
  has_config: true,
  config: { installation_id: '123456', repositories: [{ repository: 'prosights/recreate' }] },
}

function renderConnectors(handlers: Record<string, unknown> = {}) {
  return renderApp('/connectors', {
    'GET /api/github/status': githubStatus({ install_url: 'https://github.com/apps/deploy-manager/installations/new' }),
    'GET /api/doppler/status': { connector_configured: true, cli_available: true, ready: true, missing: [], message: 'Doppler is ready' },
    'GET /api/doppler/projects': ['alleyes', 'evals'],
    'GET /api/github/repositories': [githubRepository({ repository: 'prosights/recreate', web_url: 'https://github.com/prosights/recreate' })],
    'GET /api/container-registries': [],
    'GET /api/connectors': [githubConnector],
    ...handlers,
  })
}

it('renders integration cards with their status', async () => {
  const { requests } = renderConnectors({ 'GET /api/container-registries': [registry()] })

  const github = await screen.findByRole('button', { name: 'Open GitHub integration' })
  expect(within(github).getByText('Ready')).toBeInTheDocument()
  expect(within(screen.getByRole('button', { name: 'Open Doppler integration' })).getByText('Ready on this server')).toBeInTheDocument()
  expect(within(screen.getByRole('button', { name: 'Open Docker Registry integration' })).getByText('1 configured')).toBeInTheDocument()
  expect(within(screen.getByRole('button', { name: 'Open Slack integration' })).getByText('Not configured')).toBeInTheDocument()
  expect(requests.some((request) => request.method === 'POST')).toBe(false)
})

it('shows the install action when the app is configured without an installation', async () => {
  renderConnectors({ 'GET /api/connectors': [] })

  fireEvent.click(await screen.findByRole('button', { name: 'Open GitHub integration' }))
  const dialog = await screen.findByRole('dialog', { name: 'GitHub' })
  expect(within(dialog).getByText('Install required')).toBeInTheDocument()
  expect(within(dialog).getByRole('link', { name: /install github app/i })).toHaveAttribute('href', 'https://github.com/apps/deploy-manager/installations/new')
})

it('opens Doppler status and lists the visible projects', async () => {
  renderConnectors()

  fireEvent.click(await screen.findByRole('button', { name: 'Open Doppler integration' }))
  const dialog = await screen.findByRole('dialog', { name: 'Doppler' })
  expect(within(dialog).getByText('Connected Doppler account')).toBeInTheDocument()
  expect(within(dialog).getByText(/Each Compose service chooses its own Doppler project and config/)).toBeInTheDocument()
  expect(await within(dialog).findByText('alleyes')).toBeInTheDocument()
  expect(within(dialog).getByText('2 projects visible to this connector.')).toBeInTheDocument()
})

it('shows the installation and syncs GitHub repositories', async () => {
  const { requests } = renderConnectors({
    'POST /api/connectors/connector_github/github/repositories/sync': { connector: githubConnector, repositories: [] },
  })

  fireEvent.click(await screen.findByRole('button', { name: 'Open GitHub integration' }))
  const dialog = await screen.findByRole('dialog', { name: 'GitHub' })
  expect(within(dialog).getByText('GitHub App installation 123456')).toBeInTheDocument()
  expect(within(dialog).getByText('1 repository available to Paddock.')).toBeInTheDocument()
  fireEvent.click(within(dialog).getByText('Available repositories'))
  expect(within(dialog).getByRole('link', { name: /prosights\/recreate/ })).toHaveAttribute('href', 'https://github.com/prosights/recreate')

  fireEvent.click(within(dialog).getByRole('button', { name: /refresh repository list/i }))

  await waitFor(() => {
    expect(requests.some((request) => request.method === 'POST' && request.path === '/api/connectors/connector_github/github/repositories/sync')).toBe(true)
  })
  // Every successful write refetches the page's queries.
  await waitFor(() => expect(requests.filter((request) => request.path === '/api/github/repositories')).toHaveLength(2))
})

it('shows a failed repository sync inside the dialog', async () => {
  renderConnectors({
    'POST /api/connectors/connector_github/github/repositories/sync': () => { throw new HttpError(502, 'GitHub is unavailable') },
  })

  fireEvent.click(await screen.findByRole('button', { name: 'Open GitHub integration' }))
  const dialog = await screen.findByRole('dialog', { name: 'GitHub' })
  fireEvent.click(within(dialog).getByRole('button', { name: /refresh repository list/i }))
  expect(await within(dialog).findByText('GitHub is unavailable')).toBeInTheDocument()
})

it('adds a container registry', async () => {
  const { requests } = renderConnectors({
    'POST /api/container-registries': registry({ name: 'Production GHCR' }),
  })

  fireEvent.click(await screen.findByRole('button', { name: 'Open Docker Registry integration' }))
  const dialog = await screen.findByRole('dialog', { name: 'Docker Registry' })
  fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: ' Production GHCR ' } })
  fireEvent.change(within(dialog).getByLabelText('Namespace'), { target: { value: 'prosights' } })
  fireEvent.change(within(dialog).getByLabelText('Repository'), { target: { value: 'api' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Add registry' }))

  await waitFor(() => expect(within(dialog).getByLabelText('Name')).toHaveValue(''))
  expect(requests.find((request) => request.method === 'POST')).toMatchObject({
    path: '/api/container-registries',
    body: { name: 'Production GHCR', provider: 'ghcr', registry_host: 'ghcr.io', namespace: 'prosights', repository: 'api', enabled: true },
  })
})
