import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { ConnectorAccount } from '../lib/api'
import { HttpError, renderApp } from '../test/render'

afterEach(cleanup)

const connectors: ConnectorAccount[] = [
  { id: 'connector_slack', provider: 'slack', name: 'Deploy alerts', enabled: true, has_config: true, config: { channels: ['#deployments'], applications: ['production'] } },
  { id: 'connector_github', provider: 'github', name: 'GitHub', enabled: true, has_config: true, config: {} },
]

function renderNotifications(handlers: Record<string, unknown> = {}) {
  return renderApp('/notifications', { 'GET /api/connectors': connectors, ...handlers })
}

function savedConnector(requests: Array<{ method: string, path: string, body: unknown }>) {
  return requests.find((request) => request.method === 'POST' && request.path === '/api/connectors')?.body
}

it('shows notification destinations without other connectors', async () => {
  renderNotifications()

  expect(await screen.findByText('Deploy alerts')).toBeInTheDocument()
  expect(screen.getByText('Scope: production')).toBeInTheDocument()
  expect(screen.queryByText('GitHub')).not.toBeInTheDocument()
})

it('registers Slack destination metadata and resets the form', async () => {
  const { requests } = renderNotifications({ 'POST /api/connectors': connectors[0] })

  fireEvent.change(await screen.findByLabelText('Destination name'), { target: { value: 'production deploys' } })
  fireEvent.change(screen.getByLabelText('Channel'), { target: { value: '#prod-deploys' } })
  fireEvent.change(screen.getByLabelText('App or project scope'), { target: { value: 'production' } })
  fireEvent.click(screen.getByRole('button', { name: /save destination/i }))

  await waitFor(() => expect(screen.getByLabelText('Destination name')).toHaveValue('Deployments'))
  expect(savedConnector(requests)).toEqual({
    provider: 'slack',
    name: 'production deploys',
    enabled: true,
    config: { channels: ['#prod-deploys'], applications: ['production'] },
  })
})

it('registers Resend destination metadata', async () => {
  const { requests } = renderNotifications({ 'POST /api/connectors': connectors[0] })

  fireEvent.click(await screen.findByRole('button', { name: /Email via Resend/i }))
  fireEvent.change(screen.getByLabelText('Destination name'), { target: { value: 'production email' } })
  fireEvent.change(screen.getByLabelText('Recipients'), { target: { value: 'eng@prosights.co, oncall@prosights.co' } })
  fireEvent.click(screen.getByRole('button', { name: /save destination/i }))

  await waitFor(() => expect(savedConnector(requests)).toEqual({
    provider: 'resend',
    name: 'production email',
    enabled: true,
    config: {
      domains: ['prosights.co'],
      senders: ['deploy@prosights.co'],
      recipients: ['eng@prosights.co', 'oncall@prosights.co'],
      applications: [],
    },
  }))
})

it('rejects invalid input without calling the API', async () => {
  const { requests } = renderNotifications()

  fireEvent.change(await screen.findByLabelText('Channel'), { target: { value: '  ' } })
  fireEvent.submit(screen.getByRole('button', { name: /save destination/i }))

  expect(await screen.findByText('Slack channel is required.')).toBeInTheDocument()
  expect(savedConnector(requests)).toBeUndefined()
})

it('shows server errors', async () => {
  renderNotifications({ 'POST /api/connectors': () => { throw new HttpError(400, 'config contains secret material') } })

  fireEvent.click(await screen.findByRole('button', { name: /save destination/i }))

  expect(await screen.findByText('config contains secret material')).toBeInTheDocument()
})
