import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from './app-shell'

const routerState = vi.hoisted(() => ({
  location: { pathname: '/projects/project_1', hash: '#deployments' },
}))
const uiActions = vi.hoisted(() => ({ setSearchQuery: vi.fn() }))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: {
      version: '1.2.3',
      commit_sha: 'abcdef1234567890',
      build_time: '2026-07-16T00:00:00Z',
    },
  }),
  useSuspenseQueries: () => [
    {
      data: {
        name: 'Deploy Manager',
        short_name: 'Deploy',
        meta_description: 'Internal deployment control plane',
        logo_url: '',
        favicon_url: '/favicon.png',
        primary_color: '#0980fd',
        docs_url: '#',
      },
    },
    {
      data: [
        {
          id: 'project_1',
          name: 'Recreate',
          slug: 'recreate',
        },
      ],
    },
  ],
}))

vi.mock('../lib/queries', () => ({
  appVersionQuery: {},
  projectsQuery: {},
  settingsQuery: {},
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, className, children }: { to: string, className?: string, children: ReactNode }) => (
    <a href={to} className={className}>{children}</a>
  ),
  Outlet: () => <div />,
  useLocation: () => routerState.location,
}))

vi.mock('../store/ui', () => ({
  nextTheme: () => 'dark',
  useUiStore: (selector: (state: {
    sidebarCollapsed: boolean
    searchQuery: string
    setSearchQuery: (value: string) => void
    toggleSidebar: () => void
    theme: 'light'
    setTheme: () => void
  }) => unknown) => selector({
    sidebarCollapsed: false,
    searchQuery: 'queued',
    setSearchQuery: uiActions.setSearchQuery,
    toggleSidebar: vi.fn(),
    theme: 'light',
    setTheme: vi.fn(),
  }),
}))

describe('AppShell', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    routerState.location = { pathname: '/projects/project_1', hash: '#deployments' }
  })

  it('shows only the project deployments item in project context', () => {
    render(<AppShell />)

    expect(screen.getAllByText('Deployments')).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'Recreate' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to projects' })).toHaveAttribute('href', '/projects')
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument()
    expect(screen.getByText('v1.2.3 · abcdef1')).toBeInTheDocument()
  })

  it('keeps the global deployments item outside project context', () => {
    routerState.location = { pathname: '/deployments', hash: '' }

    render(<AppShell />)

    expect(screen.getByRole('link', { name: 'Deployments' })).toHaveAttribute('href', '/deployments')
    expect(screen.getByRole('heading', { name: 'Deployments' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Back to projects' })).not.toBeInTheDocument()
  })

  it('restores global search with a clear action', () => {
    render(<AppShell />)

    expect(screen.getByRole('textbox', { name: 'Search' })).toHaveValue('queued')
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(uiActions.setSearchQuery).toHaveBeenCalledWith('')
  })

  it('opens the account menu with identity only', () => {
    render(<AppShell />)

    fireEvent.pointerDown(screen.getByRole('button', { name: / account$/ }), { button: 0, ctrlKey: false })

    expect(screen.getByText('User')).toBeInTheDocument()
    expect(screen.getByText(/\S+@\S+\.\S+/)).toBeInTheDocument()
    expect(screen.queryByText('Log Out')).not.toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
  })
})
