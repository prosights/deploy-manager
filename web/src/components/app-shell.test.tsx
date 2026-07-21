import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from './app-shell'

const routerState = vi.hoisted(() => ({
  location: { pathname: '/projects/project_1', hash: '#deployments' },
}))

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
    toggleSidebar: () => void
    theme: 'light'
    setTheme: () => void
  }) => unknown) => selector({
    sidebarCollapsed: false,
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

  it('gives project pages the full content surface', () => {
    render(<AppShell />)

    expect(screen.getAllByText('Deployments')).toHaveLength(1)
    expect(screen.queryByRole('heading', { name: 'Recreate' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Back to projects' })).not.toBeInTheDocument()
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

  it('opens the account menu with identity only', () => {
    render(<AppShell />)

    fireEvent.pointerDown(screen.getByRole('button', { name: / account$/ }), { button: 0, ctrlKey: false })

    expect(screen.getByText('User')).toBeInTheDocument()
    expect(screen.getByText(/\S+@\S+\.\S+/)).toBeInTheDocument()
    expect(screen.queryByText('Log Out')).not.toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
  })
})
