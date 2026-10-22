import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { AuditEvent } from '../lib/api'
import { renderApp } from '../test/render'

afterEach(cleanup)

function auditEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: 1,
    actor: 'ali',
    action: 'deployment.queue',
    target_type: 'deployment',
    target_id: 'deployment_1',
    target_name: 'app_1',
    metadata: {},
    created_at: '2026-06-23T00:00:00Z',
    ...overrides,
  }
}

it('renders nested audit metadata as readable JSON', async () => {
  renderApp('/audit', {
    'GET /api/audit-events': [auditEvent({ metadata: { strategy: 'blue_green', commit_sha: 'abc1234', nested: { token: '[redacted]' } } })],
  })

  expect(await screen.findByText('deployment.queue')).toBeInTheDocument()
  expect(screen.getByText('deployment / deployment_1')).toBeInTheDocument()
  expect(screen.getByText(/commit_sha=abc1234/)).toBeInTheDocument()
  expect(screen.getByText(/nested=\{"token":"\[redacted\]"\}/)).toBeInTheDocument()
})

it('handles malformed audit metadata without breaking the table', async () => {
  renderApp('/audit', {
    'GET /api/audit-events': [auditEvent({ action: 'server.check', metadata: 'not-json-object' as unknown as Record<string, unknown> })],
  })

  expect(await screen.findByText('server.check')).toBeInTheDocument()
  expect(screen.getByText('{}')).toBeInTheDocument()
})

it('shows ten audit events per page', async () => {
  renderApp('/audit', {
    'GET /api/audit-events': Array.from({ length: 11 }, (_, index) => auditEvent({ id: index + 1, action: `event.${index + 1}` })),
  })

  expect(await screen.findByText('event.1')).toBeInTheDocument()
  expect(screen.queryByText('event.11')).not.toBeInTheDocument()
  expect(screen.getByText('Showing 1–10 of 11')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Next' }))

  expect(await screen.findByText('event.11')).toBeInTheDocument()
  expect(screen.queryByText('event.1')).not.toBeInTheDocument()
  expect(screen.getByText('Showing 11–11 of 11')).toBeInTheDocument()
  expect(screen.getByText('2 of 2')).toBeInTheDocument()
})
