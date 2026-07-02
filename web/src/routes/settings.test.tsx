import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { updateSettings } from '../lib/api'
import { SettingsRoute } from './settings'

vi.mock('../lib/api', () => ({
  updateSettings: vi.fn(async (input) => input),
}))

vi.mock('../lib/queries', () => ({
  settingsQuery: {
    queryKey: ['settings'],
    queryFn: async () => ({
      name: 'Prosights Deploy',
      short_name: 'Deploy',
      meta_description: 'Internal deployment control plane',
      logo_url: '/branding/prosights/prosights-co-logo.png',
      favicon_url: '/branding/prosights/favicon.png',
      primary_color: '#0980fd',
      docs_url: '#',
    }),
  },
}))

describe('SettingsRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('updates white-label branding settings', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <SettingsRoute />
      </QueryClientProvider>,
    )

    expect(await screen.findByDisplayValue('Prosights Deploy')).toBeInTheDocument()

    const shortName = screen.getByLabelText('Short name')
    fireEvent.change(shortName, { target: { value: 'Ops' } })
    fireEvent.change(screen.getByLabelText('Primary color'), { target: { value: '#22aa88' } })
    await waitFor(() => {
      expect(shortName).toHaveValue('Ops')
    })
    fireEvent.click(screen.getByRole('button', { name: /apply settings/i }))

    await waitFor(() => {
      expect(updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          short_name: 'Ops',
          primary_color: '#22aa88',
        }),
      )
    })
  })

  it('shows the preview before applying branding changes', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <SettingsRoute />
      </QueryClientProvider>,
    )

    const previewHeading = await screen.findByRole('heading', { name: 'Preview' })
    const applyButton = screen.getByRole('button', { name: /apply settings/i })

    expect(previewHeading.compareDocumentPosition(applyButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('normalizes branding settings before saving', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <SettingsRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: ' Deploy Manager ' } })
    fireEvent.change(screen.getByLabelText('Short name'), { target: { value: ' Deploy ' } })
    fireEvent.change(screen.getByLabelText('Logo URL'), { target: { value: ' /branding/prosights/prosights-co-logo.png ' } })
    fireEvent.change(screen.getByLabelText('Primary color'), { target: { value: ' ' } })
    fireEvent.change(screen.getByLabelText('Docs URL'), { target: { value: ' ' } })
    fireEvent.click(screen.getByRole('button', { name: /apply settings/i }))

    await waitFor(() => {
      expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Deploy Manager',
        short_name: 'Deploy',
        logo_url: '/branding/prosights/prosights-co-logo.png',
        primary_color: '#0980fd',
        docs_url: '#',
      }))
    })
  })

  it('saves uploaded image data URLs', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <SettingsRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Logo URL'), { target: { value: 'data:image/png;base64,aGVsbG8=' } })
    fireEvent.change(screen.getByLabelText('Favicon URL'), { target: { value: 'data:image/svg+xml;base64,PHN2Zy8+' } })
    fireEvent.click(screen.getByRole('button', { name: /apply settings/i }))

    await waitFor(() => {
      expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({
        logo_url: 'data:image/png;base64,aGVsbG8=',
        favicon_url: 'data:image/svg+xml;base64,PHN2Zy8+',
      }))
    })
  })

  it('rejects invalid primary colors before saving', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <SettingsRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Primary color'), { target: { value: 'blue' } })
    fireEvent.click(screen.getByRole('button', { name: /apply settings/i }))

    expect(await screen.findByText('Primary color must be a 6-digit hex color.')).toBeInTheDocument()
    expect(updateSettings).not.toHaveBeenCalledWith(expect.objectContaining({ primary_color: 'blue' }))
  })

  it('rejects unsafe brand URLs before saving', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <SettingsRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Logo URL'), { target: { value: 'javascript:alert(1)' } })
    fireEvent.click(screen.getByRole('button', { name: /apply settings/i }))

    expect(await screen.findByText('Logo URL must be a relative path or absolute http(s) URL.')).toBeInTheDocument()
    expect(updateSettings).not.toHaveBeenCalledWith(expect.objectContaining({ logo_url: 'javascript:alert(1)' }))
  })

  it('rejects unsupported branding asset URLs before saving', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <SettingsRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Logo URL'), { target: { value: '/branding/logo.txt' } })
    fireEvent.click(screen.getByRole('button', { name: /apply settings/i }))

    expect(await screen.findByText('Logo URL must point to a supported image asset.')).toBeInTheDocument()
    expect(updateSettings).not.toHaveBeenCalledWith(expect.objectContaining({ logo_url: '/branding/logo.txt' }))
  })

  it('rejects placeholder branding asset URLs before saving', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <SettingsRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Logo URL'), { target: { value: '#' } })
    fireEvent.click(screen.getByRole('button', { name: /apply settings/i }))

    expect(await screen.findByText('Logo URL must point to a supported image asset.')).toBeInTheDocument()
    expect(updateSettings).not.toHaveBeenCalledWith(expect.objectContaining({ logo_url: '#' }))
  })
})
