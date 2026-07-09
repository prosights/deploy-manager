import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from './app-shell'

const routerState = vi.hoisted(() => ({
  location: { pathname: '/projects/project_1', hash: '#deployments' },
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: { version: 'local', commit_sha: null } }),
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
    {
      data: [
        {
          id: 'env_1',
          project_id: 'project_1',
        },
        {
          id: 'env_2',
          project_id: 'project_1',
        },
      ],
    },
  ],
}))

vi.mock('../lib/queries', () => ({
  appVersionQuery: {},
  environmentsQuery: {},
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
    setSearchQuery: () => void
    toggleSidebar: () => void
    theme: 'light'
    setTheme: () => void
  }) => unknown) => selector({
    sidebarCollapsed: false,
    searchQuery: '',
    setSearchQuery: vi.fn(),
    toggleSidebar: vi.fn(),
    theme: 'light',
    setTheme: vi.fn(),
  }),
}))

describe('AppShell', () => {
  afterEach(() => {
    cleanup()
    routerState.location = { pathname: '/projects/project_1', hash: '#deployments' }
  })

  it('shows only the project deployments item in project context', () => {
    render(<AppShell />)

    expect(screen.getAllByText('Deployments')).toHaveLength(1)
  })

  it('keeps the global deployments item outside project context', () => {
    routerState.location = { pathname: '/deployments', hash: '' }

    render(<AppShell />)

    expect(screen.getByRole('link', { name: 'Deployments' })).toHaveAttribute('href', '/deployments')
  })
})
