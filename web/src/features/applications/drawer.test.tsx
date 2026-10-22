import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { DeploymentLog, DeploymentSlot } from '../../lib/api'
import { renderApp } from '../../test/render'
import { application, deployment, githubRepository, projectPageHandlers, proxyRoute, server } from '../../test/fixtures'

const api = application({
  compose_services: [
    { name: 'api', ports: [{ container_port: 8080, published_port: 20000 }] },
    { name: 'worker' },
  ],
})

const activeSlot: DeploymentSlot = {
  id: 'slot_blue',
  application_id: 'app_1',
  server_id: 'server_1',
  color: 'blue',
  deployment_id: 'deployment_1',
  image_ref: 'ghcr.io/prosights/api:abc1234',
  image_digest: null,
  status: 'active',
  promoted_at: null,
  created_at: '2026-07-01T12:00:00Z',
  updated_at: '2026-07-01T12:00:00Z',
}

const logs: DeploymentLog[] = [
  { id: 1, deployment_id: 'deployment_1', stream: 'system', message: 'Building next color images', created_at: '2026-07-01T12:00:00Z' },
  { id: 2, deployment_id: 'deployment_1', stream: 'stdout', message: '#1 [api internal] load build definition\n#2 [worker internal] load build definition', created_at: '2026-07-01T12:00:01Z' },
  { id: 3, deployment_id: 'deployment_1', stream: 'system', message: 'Starting next color stack', created_at: '2026-07-01T12:00:02Z' },
  { id: 4, deployment_id: 'deployment_1', stream: 'stdout', message: 'Container api-blue started', created_at: '2026-07-01T12:00:03Z' },
]

function renderDrawer(path: string, handlers: Record<string, unknown> = {}) {
  return renderApp(path, {
    ...projectPageHandlers({ applications: [api], deployments: [deployment()] }),
    'GET /api/applications/app_1/deployment-slots': [activeSlot],
    'GET /api/applications/app_1/service-variables': [],
    'GET /api/deployments/deployment_1/logs': logs,
    'GET /api/doppler/projects': ['billing'],
    'GET /api/doppler/configs': ['prd'],
    ...handlers,
  })
}

// The first render loads the whole app, so allow more than the default second.
function findDrawer() {
  return screen.findByRole('dialog', { name: 'API' }, { timeout: 3000 })
}

describe('ApplicationDrawer', () => {
  it('opens a service on the deployments tab and closes it through the URL', async () => {
    const { router } = renderDrawer('/deployments?service=app_1')

    const drawer = await findDrawer()
    for (const tab of ['Deployments', 'Variables', 'Metrics', 'Console', 'Settings']) {
      expect(within(drawer).getByRole('button', { name: tab })).toBeInTheDocument()
    }
    expect(await within(drawer).findByText('ACTIVE')).toBeInTheDocument()
    expect(within(drawer).getByText('Deployment successful')).toBeInTheDocument()
    expect(within(drawer).getByText('0 releases')).toBeInTheDocument()

    fireEvent.click(within(drawer).getByRole('button', { name: 'Settings' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ service: 'app_1', view: 'settings' }))
    expect(await within(drawer).findByRole('button', { name: 'Save settings' })).toBeInTheDocument()

    fireEvent.click(within(drawer).getByRole('button', { name: 'Close service' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(router.state.location.search).toEqual({})
  })

  it('opens a deployment, switches log tabs, and goes back to the service', async () => {
    const { router } = renderDrawer('/deployments?service=app_1')

    const drawer = await findDrawer()
    fireEvent.click(await within(drawer).findByRole('button', { name: 'Open deployment deployme' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ service: 'app_1', deployment: 'deployment_1' }))
    expect(await within(drawer).findByRole('heading', { name: 'worker' })).toBeInTheDocument()
    expect(within(drawer).getByRole('heading', { name: 'api' })).toBeInTheDocument()

    fireEvent.click(within(drawer).getByRole('button', { name: 'Build Logs' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ service: 'app_1', deployment: 'deployment_1', view: 'build-logs' }))
    expect(await within(drawer).findByText('Building next color images')).toBeInTheDocument()
    expect(within(drawer).queryByText('Container api-blue started')).not.toBeInTheDocument()

    fireEvent.click(within(drawer).getByRole('combobox', { name: 'Log service' }))
    fireEvent.click(await screen.findByRole('option', { name: 'worker' }))
    expect(await within(drawer).findByText('#2 [worker internal] load build definition')).toBeInTheDocument()
    expect(within(drawer).queryByText('#1 [api internal] load build definition')).not.toBeInTheDocument()

    fireEvent.click(within(drawer).getByRole('button', { name: 'Back to service' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ service: 'app_1' }))
    expect(await within(drawer).findByRole('button', { name: 'Deployments' })).toBeInTheDocument()
  })

  it('restarts the pinned artifact from the deployment actions menu', async () => {
    const { requests } = renderDrawer('/deployments?service=app_1', { 'POST /api/deployments': deployment({ id: 'deployment_2', status: 'queued' }) })

    const drawer = await findDrawer()
    await within(drawer).findByText('ACTIVE')
    fireEvent.pointerDown(within(drawer).getAllByRole('button', { name: 'Deployment actions' })[0], { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Restart' }))

    await waitFor(() => expect(requests).toContainEqual(expect.objectContaining({
      method: 'POST',
      path: '/api/deployments',
      body: expect.objectContaining({ application_id: 'app_1', image_ref: 'ghcr.io/prosights/api:abc1234', actor: 'restart' }),
    })))
  })

  it('dispatches the connected GitHub build when deploying', async () => {
    const { requests } = renderDrawer('/deployments?service=app_1', {
      'GET /api/applications': [{ ...api, github_auto_deploy: true }],
      'GET /api/github/repositories': [githubRepository({ application_id: 'app_1', workflow_id: 'deploy.yml', image_ref: 'ghcr.io/prosights/api' })],
      'POST /api/connectors/connector_github/github/builds/dispatch': { build: {}, deployments: [] },
    })

    const drawer = await findDrawer()
    fireEvent.click(await within(drawer).findByRole('button', { name: 'Deploy latest' }))

    await waitFor(() => expect(requests).toContainEqual(expect.objectContaining({
      method: 'POST',
      path: '/api/connectors/connector_github/github/builds/dispatch',
      body: { repository: 'prosights/api', application_id: 'app_1', branch: 'main' },
    })))
  })

  it('saves Doppler and extra variables for one compose service', async () => {
    const { requests } = renderDrawer('/deployments?service=app_1&view=variables', {
      'GET /api/applications/app_1/service-variables': [{ compose_service: 'worker', doppler_project: 'billing', doppler_config: 'prd', variables: [], configuration_revision: 1, changed: false }],
      'PUT /api/applications/app_1/service-variables/worker': ({ body }: { body: object }) => ({ compose_service: 'worker', ...body, configuration_revision: 2, changed: true }),
    })

    const drawer = await findDrawer()
    // The service that already has Doppler connected is selected first.
    expect(await within(drawer).findByRole('combobox', { name: 'Service' })).toHaveTextContent('worker')
    const serviceVariables = within(drawer).getByText('Additional variables').parentElement!.parentElement!
    fireEvent.click(within(drawer).getByRole('button', { name: 'Add service variable' }))
    fireEvent.change(within(serviceVariables).getByLabelText('Key'), { target: { value: '1BAD' } })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save worker' }))
    expect(await within(drawer).findByText(/Variable keys must use letters/)).toBeInTheDocument()

    fireEvent.change(within(serviceVariables).getByLabelText('Key'), { target: { value: 'QUEUE' } })
    fireEvent.change(within(serviceVariables).getByLabelText('Value'), { target: { value: 'default' } })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save worker' }))

    await waitFor(() => expect(requests).toContainEqual(expect.objectContaining({
      path: '/api/applications/app_1/service-variables/worker',
      body: { doppler_project: 'billing', doppler_config: 'prd', variables: [{ key: 'QUEUE', value: 'default' }] },
    })))
  })

  it('checks the server when the metrics tab opens', async () => {
    const { requests } = renderDrawer('/deployments?service=app_1&view=metrics', {
      'POST /api/servers/server_1/check': { server: server({ cpu_usage: 42 }), ssh_ok: true, docker_ok: true },
    })

    const drawer = await findDrawer()
    expect(await within(drawer).findByText('42%')).toBeInTheDocument()
    expect(requests).toContainEqual(expect.objectContaining({ method: 'POST', path: '/api/servers/server_1/check' }))
  })

  it('validates and adds a domain from settings', async () => {
    const { requests } = renderDrawer('/deployments?service=app_1&view=settings', {
      'GET /api/proxy-routes': [proxyRoute({ compose_service: 'api', upstream_url: 'http://127.0.0.1:20000' })],
      'POST /api/proxy-routes': proxyRoute({ id: 'route_2', domain: 'admin.example.com' }),
    })

    const drawer = await findDrawer()
    expect(await within(drawer).findAllByText('http://127.0.0.1:20000')).not.toHaveLength(0)
    fireEvent.click(within(drawer).getByRole('button', { name: 'Add domain' }))
    fireEvent.change(within(drawer).getByLabelText('Domain'), { target: { value: 'https://admin.example.com' } })
    fireEvent.change(within(drawer).getByLabelText('Upstream'), { target: { value: 'http://127.0.0.1:3101' } })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Add domain' }))
    expect(await within(drawer).findByText('Enter a hostname without a protocol or path.')).toBeInTheDocument()

    fireEvent.change(within(drawer).getByLabelText('Domain'), { target: { value: 'admin.example.com' } })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Add domain' }))
    await waitFor(() => expect(requests).toContainEqual(expect.objectContaining({
      method: 'POST',
      path: '/api/proxy-routes',
      body: expect.objectContaining({ application_id: 'app_1', domain: 'admin.example.com', upstream_url: 'http://127.0.0.1:3101' }),
    })))
    await waitFor(() => expect(within(drawer).queryByLabelText('Domain')).not.toBeInTheDocument())
  })

  it('saves the singleton run mode for a compose service', async () => {
    const { requests } = renderDrawer('/deployments?service=app_1&view=settings', {
      'PATCH /api/applications/app_1': api,
    })

    const drawer = await findDrawer()
    fireEvent.click((await within(drawer).findAllByRole('combobox', { name: 'Run mode' }))[1])
    fireEvent.click(await screen.findByRole('option', { name: 'Singleton' }))
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save settings' }))

    await waitFor(() => expect(requests).toContainEqual(expect.objectContaining({
      method: 'PATCH',
      path: '/api/applications/app_1',
      body: expect.objectContaining({ service_execution_modes: { api: 'follow_stack', worker: 'singleton' } }),
    })))
  })

  it('opens from the project page URL', async () => {
    const { router } = renderDrawer('/projects/project_1?service=app_1&view=metrics', {
      'POST /api/servers/server_1/check': { server: server(), ssh_ok: true, docker_ok: true },
    })

    const drawer = await findDrawer()
    expect(await within(drawer).findByText('Host snapshot')).toBeInTheDocument()
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close service' }))
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('service'))
    expect(router.state.location.pathname).toBe('/projects/project_1')
  })

  it('renders nothing for an unknown service', async () => {
    renderDrawer('/deployments?service=missing')

    expect(await screen.findByRole('searchbox', { name: 'Search deployments' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
