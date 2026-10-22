import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { HttpError, renderApp } from '../test/render'

afterEach(cleanup)

it('shows load failures and retries the failed request', async () => {
  let attempts = 0
  renderApp('/audit', {
    'GET /api/audit-events': () => {
      attempts += 1
      if (attempts === 1) throw new HttpError(503, 'database unavailable')
      return []
    },
  })

  expect(await screen.findByText('Paddock could not load')).toBeInTheDocument()
  expect(screen.getByText('database unavailable')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: /retry/i }))

  expect(await screen.findByRole('heading', { name: 'Audit trail' })).toBeInTheDocument()
  expect(attempts).toBe(2)
})
