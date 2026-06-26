import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuditRoute } from './audit'

const queryData = vi.hoisted(() => ({
  events: [
    {
      id: 1,
      actor: 'ali',
      action: 'deployment.queue',
      target_type: 'deployment',
      target_id: 'deployment_1',
      target_name: 'app_1',
      metadata: {
        strategy: 'blue_green',
        commit_sha: 'abc1234',
        nested: { token: '[redacted]' },
      } as unknown,
      created_at: '2026-06-23T00:00:00Z',
    },
  ],
}))

vi.mock('../lib/queries', () => ({
  auditEventsQuery: {
    queryKey: ['audit-events'],
    queryFn: async () => queryData.events,
  },
}))

describe('AuditRoute', () => {
  afterEach(() => {
    queryData.events = [
      {
        id: 1,
        actor: 'ali',
        action: 'deployment.queue',
        target_type: 'deployment',
        target_id: 'deployment_1',
        target_name: 'app_1',
        metadata: {
          strategy: 'blue_green',
          commit_sha: 'abc1234',
          nested: { token: '[redacted]' },
        },
        created_at: '2026-06-23T00:00:00Z',
      },
    ]
  })

  it('renders nested audit metadata as readable JSON', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <AuditRoute />
      </QueryClientProvider>,
    )

    expect(await screen.findByText('deployment.queue')).toBeInTheDocument()
    expect(screen.getByText(/commit_sha=abc1234/)).toBeInTheDocument()
    expect(screen.getByText(/nested=\{"token":"\[redacted\]"\}/)).toBeInTheDocument()
  })

  it('handles malformed audit metadata without breaking the table', async () => {
    queryData.events = [{
      id: 2,
      actor: 'system',
      action: 'server.check',
      target_type: 'server',
      target_id: 'server_1',
      target_name: 'prod-1',
      metadata: 'not-json-object',
      created_at: '2026-06-23T00:00:00Z',
    }]
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <AuditRoute />
      </QueryClientProvider>,
    )

    expect(await screen.findByText('server.check')).toBeInTheDocument()
    expect(screen.getByText('{}')).toBeInTheDocument()
  })
})
