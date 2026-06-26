import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './api'

describe('api', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parses JSON responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'ok' }), {
      headers: { 'Content-Type': 'application/json' },
    })))

    await expect(api<{ status: string }>('/api/healthz')).resolves.toEqual({ status: 'ok' })
  })

  it('allows empty successful responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))

    await expect(api<void>('/api/no-content')).resolves.toBeUndefined()
  })

  it('passes request options through to fetch', async () => {
    const signal = new AbortController().signal
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 'ok' }), {
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await api('/api/servers', { signal })

    expect(fetchMock).toHaveBeenCalledWith('/api/servers', expect.objectContaining({ signal }))
  })

  it('throws typed errors from JSON error payloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'deployment failed' }), {
      status: 400,
      statusText: 'Bad Request',
      headers: { 'Content-Type': 'application/json' },
    })))

    await expect(api('/api/deployments')).rejects.toMatchObject({
      name: 'ApiError',
      message: 'deployment failed',
      status: 400,
      path: '/api/deployments',
    } satisfies Partial<ApiError>)
  })

  it('uses plain text error bodies when JSON is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('upstream unavailable', {
      status: 502,
      statusText: 'Bad Gateway',
    })))

    await expect(api('/api/proxy-routes')).rejects.toThrow('upstream unavailable')
  })
})
