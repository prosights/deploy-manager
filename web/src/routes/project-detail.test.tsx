import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { application, environment, githubRepository, project, projectPageHandlers, proxyRoute } from '../test/fixtures'
import { renderApp, type StubRequest } from '../test/render'

const production = environment({ id: 'env_1', name: 'Production', kind: 'production' })
const staging = environment({ id: 'env_2', name: 'Staging', slug: 'staging', kind: 'development' })
const api = application({ id: 'app_1', name: 'API', environment_id: 'env_1' })
const worker = application({ id: 'app_2', name: 'Worker', environment_id: 'env_2', environment_name: 'Staging' })

function renderProject(path = '/projects/project_1', handlers: Record<string, unknown> = {}) {
  return renderApp(path, {
    ...projectPageHandlers({
      projects: [project({ description: 'Billing stack' })],
      environments: [production, staging],
      applications: [api, worker],
      repositories: [githubRepository()],
    }),
    ...handlers,
  })
}

function sent(requests: StubRequest[], method: string, path: string) {
  return requests.filter((request) => request.method === method && request.path === path)
}

it('shows the services of the production environment by default', async () => {
  renderProject()

  expect(await screen.findByRole('button', { name: 'Open API' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Open Worker' })).not.toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: 'Environment' })).toHaveTextContent('Production')
})

it('shows the environment named in the URL', async () => {
  renderProject('/projects/project_1?environment=env_2')

  expect(await screen.findByRole('button', { name: 'Open Worker' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Open API' })).not.toBeInTheDocument()
})

it('switches environment through the URL', async () => {
  const { router } = renderProject()

  fireEvent.click(await screen.findByRole('combobox', { name: 'Environment' }))
  fireEvent.click(await screen.findByRole('option', { name: 'Staging' }))

  await waitFor(() => expect(router.state.location.search).toMatchObject({ environment: 'env_2' }))
  expect(await screen.findByRole('button', { name: 'Open Worker' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Open API' })).not.toBeInTheDocument()
})

it('opens a service by putting it in the URL', async () => {
  const { router } = renderProject()

  fireEvent.click(await screen.findByRole('button', { name: 'Open API' }))

  await waitFor(() => expect(router.state.location.search).toMatchObject({ service: 'app_1', environment: 'env_1' }))
})

it('shows not found for an unknown project', async () => {
  renderProject('/projects/missing')

  expect(await screen.findByRole('heading', { name: 'Project not found' })).toBeInTheDocument()
})

it('shows routed and private compose services on the card and in service ports', async () => {
  renderProject('/projects/project_1', {
    'GET /api/applications': [application({ compose_services: [{ name: 'api' }, { name: 'worker' }] })],
    'GET /api/proxy-routes': [proxyRoute({ compose_service: 'api', container_port: 8080, blue_upstream_url: 'http://127.0.0.1:20000', green_upstream_url: 'http://127.0.0.1:20001', upstream_url: 'http://127.0.0.1:20001' })],
  })

  const card = await screen.findByRole('button', { name: 'Open API' })
  expect(within(card).getByRole('link', { name: 'https://api.example.com' })).toBeInTheDocument()
  expect(within(card).getByText(':20001')).toBeInTheDocument()
  expect(within(card).getByText('private')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Service ports' }))
  const ports = await screen.findByRole('dialog', { name: 'Service ports' })
  const apiRow = within(ports).getByText('api').closest('tr')
  expect(apiRow).toHaveTextContent(':8080/tcp')
  expect(apiRow).toHaveTextContent('http://127.0.0.1:20000')
  expect(within(ports).getByText('worker')).toBeInTheDocument()
  expect(within(ports).getByText('Private')).toBeInTheDocument()
})

it('pans the canvas, moves and resizes cards, and remembers the layout', async () => {
  renderProject()
  const canvas = await screen.findByRole('region', { name: 'Architecture' })
  const card = screen.getByRole('button', { name: 'Open API' })

  fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
  fireEvent.pointerMove(canvas, { pointerId: 1, clientX: -900, clientY: -700 })
  fireEvent.pointerUp(canvas, { pointerId: 1, clientX: -900, clientY: -700 })
  expect(canvas).toHaveStyle({ backgroundPosition: '-1000px -800px' })
  expect(JSON.parse(localStorage.getItem('deploy-manager:architecture-camera:project_1') ?? '{}')).toEqual({ x: -1000, y: -800 })

  fireEvent.pointerDown(card, { button: 0, pointerId: 2, clientX: 100, clientY: 100 })
  fireEvent.pointerMove(card, { pointerId: 2, clientX: -200, clientY: -200 })
  fireEvent.pointerUp(card, { pointerId: 2, clientX: -200, clientY: -200 })
  expect(card).toHaveStyle({ transform: 'translate3d(-264px, -264px, 0)' })

  const resize = within(card).getByRole('button', { name: 'Resize API' })
  fireEvent.pointerDown(resize, { button: 0, pointerId: 3, clientX: 0, clientY: 0 })
  fireEvent.pointerMove(resize, { pointerId: 3, clientX: -1000, clientY: -1000 })
  fireEvent.pointerUp(resize, { pointerId: 3, clientX: -1000, clientY: -1000 })
  expect(card).toHaveStyle({ width: '220px', height: '148px' })

  expect(JSON.parse(localStorage.getItem('deploy-manager:architecture:project_1') ?? '{}')).toEqual({ app_1: { x: -264, y: -264, width: 220, height: 148 } })
})

it('restores the stored canvas layout', async () => {
  localStorage.setItem('deploy-manager:architecture:project_1', JSON.stringify({ app_1: { x: 88, y: 132, width: 300 } }))
  localStorage.setItem('deploy-manager:architecture-camera:project_1', JSON.stringify({ x: 10, y: 20 }))
  renderProject()

  const card = await screen.findByRole('button', { name: 'Open API' })
  expect(card).toHaveStyle({ transform: 'translate3d(88px, 132px, 0)', width: '300px' })
  expect(screen.getByRole('region', { name: 'Architecture' })).toHaveStyle({ backgroundPosition: '10px 20px' })
})

it('scans a GitHub repository and imports the selected services', async () => {
  const detected = { name: 'api', root: 'api', compose_path: 'api/compose.yml', path_filters: ['api/**'] }
  const { requests } = renderProject('/projects/project_1', {
    'GET /api/github/repositories/branches': { repository: 'prosights/api', branches: ['main', 'release/2026-07'] },
    'GET /api/github/repositories/detect': { repository: 'prosights/api', branch: 'release/2026-07', services: [detected] },
    'POST /api/projects/project_1/github/import': { applications: [] },
  })

  fireEvent.click(await screen.findByRole('button', { name: 'Add service' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add service' })
  fireEvent.pointerDown(within(dialog).getByRole('button', { name: 'Branch: main' }), { button: 0, ctrlKey: false })
  fireEvent.click(await screen.findByRole('menuitem', { name: 'release/2026-07' }))
  fireEvent.change(within(dialog).getByLabelText('Root directory (optional)'), { target: { value: 'api' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Scan repository' }))

  expect(await within(dialog).findByText('api/compose.yml')).toBeInTheDocument()
  const scan = sent(requests, 'GET', '/api/github/repositories/detect')
  expect(scan).toHaveLength(1)
  expect(Object.fromEntries(scan[0].url.searchParams)).toEqual({
    connector_id: 'connector_github', repository: 'prosights/api', branch: 'release/2026-07', root: 'api',
  })

  // Changing an input hides results that no longer match it.
  fireEvent.change(within(dialog).getByLabelText('Root directory (optional)'), { target: { value: 'web' } })
  expect(within(dialog).queryByText('api/compose.yml')).not.toBeInTheDocument()
  expect(within(dialog).getByRole('button', { name: 'Import services' })).toBeDisabled()
  fireEvent.change(within(dialog).getByLabelText('Root directory (optional)'), { target: { value: 'api' } })

  fireEvent.click(await within(dialog).findByRole('button', { name: 'Import 1 service' }))
  await waitFor(() => expect(sent(requests, 'POST', '/api/projects/project_1/github/import')).toHaveLength(1))
  expect(sent(requests, 'POST', '/api/projects/project_1/github/import')[0]).toMatchObject({
    body: {
      connector_id: 'connector_github',
      repository: 'prosights/api',
      branch: 'release/2026-07',
      root: 'api',
      environment_id: 'env_1',
      server_id: 'server_1',
      services: ['api'],
      detected_services: [detected],
    },
  })
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add service' })).not.toBeInTheDocument())
})

it('saves project identity from project settings', async () => {
  const { requests } = renderProject('/projects/project_1', { 'PATCH /api/projects/project_1': project({ name: 'Payments' }) })

  fireEvent.click(await screen.findByRole('button', { name: 'Project settings' }))
  const dialog = await screen.findByRole('dialog', { name: 'Project settings' })
  fireEvent.change(within(dialog).getByLabelText('Project name'), { target: { value: 'Payments' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save project' }))

  await waitFor(() => expect(sent(requests, 'PATCH', '/api/projects/project_1')).toHaveLength(1))
  expect(sent(requests, 'PATCH', '/api/projects/project_1')[0]).toMatchObject({ body: { name: 'Payments', slug: 'billing', description: 'Billing stack' } })
})

it('adds environments and confirms deletion inline', async () => {
  const { requests } = renderProject('/projects/project_1', {
    'POST /api/environments': environment({ id: 'env_3', name: 'QA', kind: 'development' }),
    'DELETE /api/environments/env_2': () => undefined,
    'GET /api/applications': [api],
  })

  fireEvent.click(await screen.findByRole('button', { name: 'Project settings' }))
  const dialog = await screen.findByRole('dialog', { name: 'Project settings' })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Environments' }))
  fireEvent.change(within(dialog).getByLabelText('Environment name'), { target: { value: 'QA' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Add environment' }))

  await waitFor(() => expect(sent(requests, 'POST', '/api/environments')).toHaveLength(1))
  expect(sent(requests, 'POST', '/api/environments')[0]).toMatchObject({ body: { project_id: 'project_1', name: 'QA', slug: 'qa', kind: 'development', is_ephemeral: false } })
  expect(within(dialog).getByRole('button', { name: 'Delete environment Production' })).toBeDisabled()

  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete environment Staging' }))
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))
  await waitFor(() => expect(sent(requests, 'DELETE', '/api/environments/env_2')).toHaveLength(1))
})

it('validates shared variables before saving and redeploys stale services', async () => {
  const { requests } = renderProject('/projects/project_1', {
    'GET /api/applications': [application({ redeploy_required: true })],
    'GET /api/projects/project_1/variables': { variables: [{ key: 'PUBLIC_API_URL', value: 'https://api.internal' }], configuration_revision: 1 },
    'PUT /api/projects/project_1/variables': { variables: [], configuration_revision: 2 },
    'POST /api/projects/project_1/redeploy-configuration': { queued: 1 },
  })

  fireEvent.click(await screen.findByRole('button', { name: 'Project settings' }))
  const dialog = await screen.findByRole('dialog', { name: 'Project settings' })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Shared variables' }))
  fireEvent.change(await within(dialog).findByLabelText('Key'), { target: { value: '1BAD' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save variables' }))

  expect(await within(dialog).findByText(/Variable keys must use letters/)).toBeInTheDocument()
  expect(sent(requests, 'PUT', '/api/projects/project_1/variables')).toHaveLength(0)

  fireEvent.change(within(dialog).getByLabelText('Key'), { target: { value: 'PUBLIC_API_URL' } })
  fireEvent.change(within(dialog).getByLabelText('Value'), { target: { value: 'https://new.internal' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save variables' }))
  await waitFor(() => expect(sent(requests, 'PUT', '/api/projects/project_1/variables')).toHaveLength(1))
  expect(sent(requests, 'PUT', '/api/projects/project_1/variables')[0]).toMatchObject({ body: { variables: [{ key: 'PUBLIC_API_URL', value: 'https://new.internal' }] } })

  fireEvent.click(within(dialog).getByRole('button', { name: 'Redeploy all' }))
  await waitFor(() => expect(sent(requests, 'POST', '/api/projects/project_1/redeploy-configuration')).toHaveLength(1))
})

it('deletes the project only after its exact name is typed', async () => {
  const { requests, router } = renderProject('/projects/project_1', { 'DELETE /api/projects/project_1': () => undefined })

  fireEvent.click(await screen.findByRole('button', { name: 'Project settings' }))
  const dialog = await screen.findByRole('dialog', { name: 'Project settings' })
  expect(within(within(dialog).getByRole('list', { name: 'Services that will be deleted' })).getByText('Production · healthy')).toBeInTheDocument()
  const deleteButton = within(dialog).getByRole('button', { name: 'Delete project' })
  fireEvent.change(within(dialog).getByLabelText('Type Billing to confirm'), { target: { value: 'billing' } })
  expect(deleteButton).toBeDisabled()
  fireEvent.change(within(dialog).getByLabelText('Type Billing to confirm'), { target: { value: 'Billing' } })
  fireEvent.click(deleteButton)

  await waitFor(() => expect(router.state.location.pathname).toBe('/projects'))
  expect(sent(requests, 'DELETE', '/api/projects/project_1')).toHaveLength(1)
})
