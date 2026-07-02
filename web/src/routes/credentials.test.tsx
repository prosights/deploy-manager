import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { syncCredentialInventory } from '../lib/api'
import { CredentialsRoute } from './credentials'

vi.mock('../lib/api', () => ({
  syncCredentialInventory: vi.fn(async (input) => ({ credentials: input.credentials, count: input.credentials.length })),
}))

vi.mock('../lib/queries', () => ({
  credentialsQuery: {
    queryKey: ['credentials'],
    queryFn: async () => [
      {
        id: 'cred_1',
        name: 'GitHub deploy key',
        provider: 'github',
        external_ref: 'repo:prosights/api',
        credential_type: 'deploy_key',
        status: 'active',
        permission_count: 3,
        usage_count: 2,
        last_seen_at: null,
      },
    ],
  },
  credentialDetailQuery: () => ({
    queryKey: ['credentials', 'cred_1'],
    queryFn: async () => ({
      credential: {
        id: 'cred_1',
        name: 'GitHub deploy key',
        provider: 'github',
        external_ref: 'repo:prosights/api',
        credential_type: 'deploy_key',
        status: 'active',
        permission_count: 3,
        usage_count: 2,
        last_seen_at: null,
      },
      permissions: [
        {
          id: 'perm_1',
          credential_id: 'cred_1',
          resource_type: 'repository',
          resource_name: 'prosights/api',
          permission: 'contents:read',
          source: 'github',
          created_at: '2026-06-23T00:00:00Z',
        },
      ],
      usages: [
        {
          id: 'usage_1',
          credential_id: 'cred_1',
          used_by_type: 'application',
          used_by_name: 'api',
          usage_context: 'clone repository',
          created_at: '2026-06-23T00:00:00Z',
        },
      ],
    }),
  }),
}))

describe('CredentialsRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  function renderRoute() {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <CredentialsRoute />
      </QueryClientProvider>,
    )
  }

  it('makes permission and usage inventory visible', async () => {
    renderRoute()

    expect(await screen.findByText('GitHub deploy key')).toBeInTheDocument()
    expect(screen.getByText('Inventory coverage')).toBeInTheDocument()
    expect(screen.getByText('Access facts')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /inspect/i }))
    expect(screen.getAllByText('Access').length).toBeGreaterThan(0)
    expect(screen.getByText('Used by')).toBeInTheDocument()
    expect(await screen.findByText('Reference')).toBeInTheDocument()
    expect(screen.getByText(/Secret values stay in their source systems/)).toBeInTheDocument()
    expect(await screen.findByText('contents:read')).toBeInTheDocument()
    expect(screen.getByText('clone repository')).toBeInTheDocument()
  })

  it('imports connector-produced credential inventory facts', async () => {
    renderRoute()

    fireEvent.change(await screen.findByLabelText('Connector JSON'), {
      target: {
        value: JSON.stringify({
          credentials: [{
            name: 'S3 deploy account',
            provider: 'S3',
            external_ref: 'arn:aws:iam::123:role/deploy',
            credential_type: 'iam_role',
            permissions: [{ resource_type: 'bucket', resource_name: 's3://assets', permission: 'read' }],
            usages: [{ used_by_type: 'application', used_by_name: 'api', usage_context: 'read assets' }],
          }],
        }),
      },
    })
    fireEvent.click(screen.getByRole('button', { name: /import facts/i }))

    await waitFor(() => {
      expect(syncCredentialInventory).toHaveBeenCalledWith({
        credentials: [expect.objectContaining({
          name: 'S3 deploy account',
          provider: 's3',
          external_ref: 'arn:aws:iam::123:role/deploy',
          permissions: [expect.objectContaining({
            source: 'connector',
          })],
        })],
      })
    })
    expect(await screen.findByText('Imported 1 credential records.')).toBeInTheDocument()
  })

  it('normalizes credential identity and fact fields before import', async () => {
    renderRoute()

    fireEvent.change(await screen.findByLabelText('Connector JSON'), {
      target: {
        value: JSON.stringify({
          credentials: [{
            name: ' Deploy key ',
            provider: ' GitHub ',
            external_ref: ' repo:prosights/api ',
            credential_type: ' deploy_key ',
            status: ' rotating ',
            permissions: [{
              resource_type: ' repository ',
              resource_name: ' prosights/api ',
              permission: ' contents:read ',
              source: ' github ',
            }],
            usages: [{
              used_by_type: ' application ',
              used_by_name: ' api ',
              usage_context: ' clone repository ',
            }],
          }],
        }),
      },
    })
    fireEvent.click(screen.getByRole('button', { name: /import facts/i }))

    await waitFor(() => {
      expect(syncCredentialInventory).toHaveBeenCalledWith({
        credentials: [{
          name: 'Deploy key',
          provider: 'github',
          external_ref: 'repo:prosights/api',
          credential_type: 'deploy_key',
          status: 'rotating',
          permissions: [{
            resource_type: 'repository',
            resource_name: 'prosights/api',
            permission: 'contents:read',
            source: 'github',
          }],
          usages: [{
            used_by_type: 'application',
            used_by_name: 'api',
            usage_context: 'clone repository',
          }],
        }],
      })
    })
  })

  it('rejects inventory JSON without credentials', async () => {
    renderRoute()

    fireEvent.change(await screen.findByLabelText('Connector JSON'), { target: { value: '{"credentials":[]}' } })
    fireEvent.click(screen.getByRole('button', { name: /import facts/i }))

    expect(await screen.findByText('Inventory JSON must include at least one credential.')).toBeInTheDocument()
    expect(syncCredentialInventory).not.toHaveBeenCalled()
  })

  it('rejects unsupported credential inventory providers before import', async () => {
    renderRoute()

    fireEvent.change(await screen.findByLabelText('Connector JSON'), {
      target: {
        value: JSON.stringify({
          credentials: [{
            name: 'Vault token',
            provider: 'vault',
            external_ref: 'secret:deploy',
            credential_type: 'token',
          }],
        }),
      },
    })
    fireEvent.click(screen.getByRole('button', { name: /import facts/i }))

    expect(await screen.findByText('Credential provider must be github, doppler, s3, gcs, slack, resend, or ssh.')).toBeInTheDocument()
    expect(syncCredentialInventory).not.toHaveBeenCalled()
  })

  it('rejects invalid credential status before import', async () => {
    renderRoute()

    fireEvent.change(await screen.findByLabelText('Connector JSON'), {
      target: {
        value: JSON.stringify({
          credentials: [{
            name: 'GitHub deploy key',
            provider: 'github',
            external_ref: 'repo:prosights/api',
            credential_type: 'deploy_key',
            status: 'disabled',
          }],
        }),
      },
    })
    fireEvent.click(screen.getByRole('button', { name: /import facts/i }))

    expect(await screen.findByText('Credential status must be active, rotating, revoked, or unknown.')).toBeInTheDocument()
    expect(syncCredentialInventory).not.toHaveBeenCalled()
  })

  it('rejects incomplete credential facts before import', async () => {
    renderRoute()

    fireEvent.change(await screen.findByLabelText('Connector JSON'), {
      target: {
        value: JSON.stringify({
          credentials: [{
            name: 'GitHub deploy key',
            provider: 'github',
            external_ref: 'repo:prosights/api',
            credential_type: 'deploy_key',
            usages: [{ used_by_type: 'application', used_by_name: 'api', usage_context: ' ' }],
          }],
        }),
      },
    })
    fireEvent.click(screen.getByRole('button', { name: /import facts/i }))

    expect(await screen.findByText('Usage context is required.')).toBeInTheDocument()
    expect(syncCredentialInventory).not.toHaveBeenCalled()
  })

  it('rejects malformed credential permission facts before import', async () => {
    renderRoute()

    fireEvent.change(await screen.findByLabelText('Connector JSON'), {
      target: {
        value: JSON.stringify({
          credentials: [{
            name: 'GitHub deploy key',
            provider: 'github',
            external_ref: 'repo:prosights/api',
            credential_type: 'deploy_key',
            permissions: { resource_type: 'repository' },
          }],
        }),
      },
    })
    fireEvent.click(screen.getByRole('button', { name: /import facts/i }))

    expect(await screen.findByText('Credential permissions must be an array.')).toBeInTheDocument()
    expect(syncCredentialInventory).not.toHaveBeenCalled()
  })

  it('rejects malformed credential usage facts before import', async () => {
    renderRoute()

    fireEvent.change(await screen.findByLabelText('Connector JSON'), {
      target: {
        value: JSON.stringify({
          credentials: [{
            name: 'GitHub deploy key',
            provider: 'github',
            external_ref: 'repo:prosights/api',
            credential_type: 'deploy_key',
            usages: { used_by_type: 'application' },
          }],
        }),
      },
    })
    fireEvent.click(screen.getByRole('button', { name: /import facts/i }))

    expect(await screen.findByText('Credential usages must be an array.')).toBeInTheDocument()
    expect(syncCredentialInventory).not.toHaveBeenCalled()
  })

  it('rejects oversized credential inventory batches before import', async () => {
    renderRoute()

    fireEvent.change(await screen.findByLabelText('Connector JSON'), {
      target: {
        value: JSON.stringify({
          credentials: Array.from({ length: 501 }, (_, index) => ({
            name: `Deploy key ${index}`,
            provider: 'github',
            external_ref: `repo:prosights/api#deploy-key-${index}`,
            credential_type: 'deploy_key',
          })),
        }),
      },
    })
    fireEvent.click(screen.getByRole('button', { name: /import facts/i }))

    expect(await screen.findByText('Credential inventory batch cannot exceed 500 credentials.')).toBeInTheDocument()
    expect(syncCredentialInventory).not.toHaveBeenCalled()
  })

  it('rejects secret-like credential inventory fields before import', async () => {
    renderRoute()

    fireEvent.change(await screen.findByLabelText('Connector JSON'), {
      target: {
        value: JSON.stringify({
          credentials: [{
            name: 'GitHub deploy key',
            provider: 'github',
            external_ref: 'repo:prosights/api',
            credential_type: 'deploy_key',
            apiToken: 'secret-value',
          }],
        }),
      },
    })
    fireEvent.click(screen.getByRole('button', { name: /import facts/i }))

    expect(await screen.findByText('Credential inventory cannot contain secrets, tokens, passwords, private keys, or API keys.')).toBeInTheDocument()
    expect(syncCredentialInventory).not.toHaveBeenCalled()
  })

  it('rejects raw secret material in credential references before import', async () => {
    renderRoute()

    fireEvent.change(await screen.findByLabelText('Connector JSON'), {
      target: {
        value: JSON.stringify({
          credentials: [{
            name: 'GitHub deploy key',
            provider: 'github',
            external_ref: '-----BEGIN PRIVATE KEY-----',
            credential_type: 'deploy_key',
          }],
        }),
      },
    })
    fireEvent.click(screen.getByRole('button', { name: /import facts/i }))

    expect(await screen.findByText('Credential external_ref must be a reference, not a secret value.')).toBeInTheDocument()
    expect(syncCredentialInventory).not.toHaveBeenCalled()
  })

  it('rejects JSON credential material in credential references before import', async () => {
    renderRoute()

    fireEvent.change(await screen.findByLabelText('Connector JSON'), {
      target: {
        value: JSON.stringify({
          credentials: [{
            name: 'GCP service account',
            provider: 'gcs',
            external_ref: JSON.stringify({ private_key_id: 'abc123', client_email: 'deploy@example.com' }),
            credential_type: 'service_account',
          }],
        }),
      },
    })
    fireEvent.click(screen.getByRole('button', { name: /import facts/i }))

    expect(await screen.findByText('Credential external_ref must be a reference, not a secret value.')).toBeInTheDocument()
    expect(syncCredentialInventory).not.toHaveBeenCalled()
  })
})
