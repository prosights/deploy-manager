import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { application, deployment, environment, project, projectPageHandlers } from '../test/fixtures'
import { HttpError, renderApp } from '../test/render'

afterEach(cleanup)

const billing = project({ id: 'project_1', name: 'Billing', slug: 'billing', description: 'Billing stack' })
const recreate = project({ id: 'project_2', name: 'Recreate', slug: 'recreate' })

function renderProjects(handlers: Record<string, unknown> = {}) {
  return renderApp('/projects', {
    ...projectPageHandlers({
      projects: [billing, recreate],
      environments: [environment({ project_id: 'project_1' })],
      applications: [application({ project_id: 'project_1', status: 'healthy' })],
      deployments: [deployment({ application_id: 'app_1', created_at: '2026-07-16T12:00:00Z' })],
    }),
    ...handlers,
  })
}

it('renders one tile per project with service, environment and deployment facts', async () => {
  renderProjects()

  const tile = await screen.findByRole('link', { name: 'Open project Billing' })
  expect(within(tile).getByText('1 service')).toBeInTheDocument()
  expect(within(tile).getByText('1 env')).toBeInTheDocument()
  expect(within(tile).getByText(/last deploy/)).toBeInTheDocument()
  expect(within(tile).getByText('healthy')).toBeInTheDocument()

  const empty = screen.getByRole('link', { name: 'Open project Recreate' })
  expect(within(empty).getByText('0 services')).toBeInTheDocument()
  expect(within(empty).getByText('never deployed')).toBeInTheDocument()
})

it('creates a project with a normalized slug and opens it', async () => {
  const { requests, router } = renderProjects({
    'POST /api/projects': ({ body }: { body: { name: string, slug: string } }) => project({ id: 'project_3', ...body }),
  })

  fireEvent.click(await screen.findByRole('button', { name: 'Create project' }))
  const dialog = await screen.findByRole('dialog', { name: 'Create project' })
  fireEvent.change(within(dialog).getByLabelText('Project name'), { target: { value: 'API Platform' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

  await waitFor(() => expect(router.state.location.pathname).toBe('/projects/project_3'))
  expect(requests.find((request) => request.method === 'POST')).toMatchObject({
    path: '/api/projects',
    body: { name: 'API Platform', slug: 'api-platform', description: '' },
  })
})

it('shows the server error and keeps the dialog open when creation fails', async () => {
  renderProjects({
    'POST /api/projects': () => { throw new HttpError(409, 'slug already exists') },
  })

  fireEvent.click(await screen.findByRole('button', { name: 'Create project' }))
  const dialog = await screen.findByRole('dialog', { name: 'Create project' })
  fireEvent.change(within(dialog).getByLabelText('Project name'), { target: { value: 'Billing' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

  expect(await within(dialog).findByText('slug already exists')).toBeInTheDocument()

  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
  const reopened = await screen.findByRole('dialog', { name: 'Create project' })
  expect(within(reopened).getByLabelText('Project name')).toHaveValue('')
  expect(within(reopened).queryByText('slug already exists')).not.toBeInTheDocument()
})

it('searches and filters projects', async () => {
  renderProjects()

  fireEvent.change(await screen.findByLabelText('Search projects'), { target: { value: 'recreate' } })
  expect(screen.queryByText('Billing')).not.toBeInTheDocument()
  expect(screen.getByText('Recreate')).toBeInTheDocument()

  fireEvent.change(screen.getByLabelText('Search projects'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('combobox', { name: 'Filter projects by status' }))
  fireEvent.click(await screen.findByRole('option', { name: 'Healthy' }))
  expect(screen.getByText('Billing')).toBeInTheDocument()
  expect(screen.queryByText('Recreate')).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('combobox', { name: 'Filter projects by status' }))
  fireEvent.click(await screen.findByRole('option', { name: 'Empty' }))
  expect(screen.queryByText('Billing')).not.toBeInTheDocument()
  expect(screen.getByText('Recreate')).toBeInTheDocument()
})
