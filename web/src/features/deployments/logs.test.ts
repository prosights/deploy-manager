import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { DeploymentLog } from '../../lib/api'
import { renderApp } from '../../test/render'
import { deployment, projectPageHandlers } from '../../test/fixtures'
import { expandLogLines } from './logs'

describe('expandLogLines', () => {
  it('renders command output as individual terminal lines', () => {
    const logs: DeploymentLog[] = [{
      id: 7,
      deployment_id: 'deployment_1',
      stream: 'stdout',
      message: 'Building image\r\nContainer started\nHealth check passed',
      created_at: '2026-07-16T12:00:00Z',
    }]

    expect(expandLogLines(logs).map((entry) => entry.message)).toEqual([
      'Building image',
      'Container started',
      'Health check passed',
    ])
  })

  it('limits expanded output to the newest 500 lines', () => {
    const logs: DeploymentLog[] = [{
      deployment_id: 'deployment_1',
      stream: 'stdout',
      message: Array.from({ length: 510 }, (_, index) => `line ${index}`).join('\n'),
    }]

    const expanded = expandLogLines(logs)

    expect(expanded).toHaveLength(500)
    expect(expanded[0]?.message).toBe('line 10')
    expect(expanded.at(-1)?.message).toBe('line 509')
  })
})

describe('DeploymentLogStream', () => {
  it('shows a deployment\'s stored logs with times and filters them', async () => {
    renderApp('/deployments?service=app_1&deployment=deployment_1&view=deploy-logs', {
      ...projectPageHandlers({ deployments: [deployment()] }),
      'GET /api/applications/app_1/deployment-slots': [],
      'GET /api/deployments/deployment_1/logs': [
        { id: 1, deployment_id: 'deployment_1', stream: 'stdout', message: 'Container started', created_at: '2026-07-16T12:00:00Z' },
        { id: 2, deployment_id: 'deployment_1', stream: 'stderr', message: 'Health check failed', created_at: '2026-07-16T12:00:01Z' },
      ],
    })

    const drawer = await screen.findByRole('dialog', {}, { timeout: 3000 })
    expect(await within(drawer).findByText('Container started')).toBeInTheDocument()
    expect(within(drawer).getByText('Time')).toBeInTheDocument()
    expect(within(drawer).getAllByText(/\d{2}:\d{2}:\d{2}\.\d{3}/)).toHaveLength(2)

    fireEvent.change(within(drawer).getByRole('textbox', { name: 'Filter logs' }), { target: { value: 'health' } })
    expect(within(drawer).queryByText('Container started')).not.toBeInTheDocument()
    expect(within(drawer).getByText('Health check failed')).toBeInTheDocument()
  })
})
