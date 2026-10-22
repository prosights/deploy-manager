import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderApp } from '../test/render'
import { application, deployment, githubRepository, project, projectPageHandlers } from '../test/fixtures'

const deployments = [
  deployment({ id: '11111111-1111', trigger: 'github_push', status: 'running', commit_sha: 'abc123456789', commit_message: 'Add invoice webhooks', finished_at: null, created_at: '2026-06-23T00:03:00Z' }),
  deployment({ id: '22222222-2222', status: 'failed', commit_sha: 'def567890123', commit_message: 'Fix retry handling', created_at: '2026-06-23T00:02:00Z' }),
  deployment({ id: '33333333-3333', application_id: 'app_2', application_name: 'worker', project_id: 'project_2', project_name: 'Internal', trigger: 'retry', commit_message: 'Ship monthly digest', created_at: '2026-06-23T00:01:00Z' }),
  ...Array.from({ length: 10 }, (_, index) => deployment({
    id: `${String(index + 4).padStart(8, '0')}-3333`,
    application_id: 'app_2',
    application_name: 'worker',
    project_id: 'project_2',
    project_name: 'Internal',
    commit_message: `Worker release ${index + 4}`,
    created_at: `2026-06-22T23:${String(59 - index).padStart(2, '0')}:00Z`,
  })),
]

function renderDeployments(path = '/deployments') {
  return renderApp(path, {
    ...projectPageHandlers({
      projects: [project(), project({ id: 'project_2', name: 'Internal', slug: 'internal' })],
      applications: [application({ name: 'api' }), application({ id: 'app_2', name: 'worker', project_id: 'project_2' })],
      deployments,
      repositories: [githubRepository({ application_id: 'app_1' })],
    }),
    'GET /api/github/repositories/commit': {
      sha: 'abc123456789',
      message: 'Merge billing notifications\n\nIncludes invoice webhooks.',
      author_name: 'Octo Cat',
      author_login: 'octocat',
      author_avatar_url: 'https://avatars.example.com/octocat.png',
      html_url: '',
    },
    'GET /api/applications/app_1/deployment-slots': [],
    'GET /api/deployments/22222222-2222/logs': [],
    'POST /api/deployments/22222222-2222/retry': deployment({ id: '22222222-2222', status: 'queued' }),
  })
}

// The first render loads the whole app, so allow more than the default second.
function findTable() {
  return screen.findByRole('table', {}, { timeout: 3000 })
}

describe('DeploymentsRoute', () => {
  it('lists deployments with commit messages and GitHub attribution', async () => {
    renderDeployments()

    await findTable()
    for (const heading of ['Status', 'Commit', 'Service / Project', 'Strategy', 'Trigger', 'Deployed', 'SHA']) {
      expect(screen.getByRole('columnheader', { name: heading })).toBeInTheDocument()
    }
    expect((await screen.findAllByText('Merge billing notifications')).length).toBeGreaterThan(0)
    expect((await screen.findAllByTitle('octocat'))[0].querySelector('img')).toHaveAttribute('src', 'https://avatars.example.com/octocat.png')
    expect(screen.getAllByText('via GitHub').length).toBeGreaterThan(0)
  })

  it('searches deployment messages and metadata', async () => {
    renderDeployments()

    fireEvent.change(await screen.findByRole('searchbox', { name: 'Search deployments' }, { timeout: 3000 }), { target: { value: 'monthly digest' } })

    expect(screen.getByText('Ship monthly digest')).toBeInTheDocument()
    expect(screen.queryByText('Fix retry handling')).not.toBeInTheDocument()
  })

  it('filters deployments by service', async () => {
    renderDeployments()

    await findTable()
    fireEvent.click(screen.getByRole('combobox', { name: 'Service' }))
    fireEvent.click(await screen.findByRole('option', { name: 'worker' }))

    expect(screen.getByText('Ship monthly digest')).toBeInTheDocument()
    expect(screen.queryByText('Fix retry handling')).not.toBeInTheDocument()
  })

  it('paginates the filtered list', async () => {
    renderDeployments()

    await findTable()
    expect(screen.getByText('Showing 1–10 of 13')).toBeInTheDocument()
    expect(screen.queryByText('Worker release 13')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByText('Worker release 13')).toBeInTheDocument()
    expect(screen.queryByText('Fix retry handling')).not.toBeInTheDocument()
  })

  it('keeps the project filter in the URL', async () => {
    const { router } = renderDeployments()

    await findTable()
    fireEvent.click(screen.getByRole('combobox', { name: 'Project' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Internal' }))

    await waitFor(() => expect(router.state.location.search).toEqual({ project: 'project_2' }))
    expect(screen.getByText('Ship monthly digest')).toBeInTheDocument()
    expect(screen.queryByText('Fix retry handling')).not.toBeInTheDocument()
  })

  it('restores the project filter from the URL', async () => {
    renderDeployments('/deployments?project=project_1')

    await findTable()
    expect(screen.getByText('Fix retry handling')).toBeInTheDocument()
    expect(screen.queryByText('Ship monthly digest')).not.toBeInTheDocument()
  })

  it('opens a deployment in the drawer, retries it, and closes it', async () => {
    const { router, requests } = renderDeployments('/deployments?project=project_1')

    await findTable()
    fireEvent.click(screen.getByRole('button', { name: 'Open deployment 22222222' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ project: 'project_1', service: 'app_1', deployment: '22222222-2222' }))

    const drawer = await screen.findByRole('dialog', {}, { timeout: 3000 })
    expect(await within(drawer).findByText('Deployment failed')).toBeInTheDocument()
    fireEvent.pointerDown(within(drawer).getByRole('button', { name: 'Deployment actions' }), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Redeploy' }))
    await waitFor(() => expect(requests).toContainEqual(expect.objectContaining({ method: 'POST', path: '/api/deployments/22222222-2222/retry' })))

    fireEvent.click(within(drawer).getByRole('button', { name: 'Close deployment' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(router.state.location.search).toEqual({ project: 'project_1' })
  })
})
