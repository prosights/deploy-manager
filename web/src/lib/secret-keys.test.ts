import { describe, expect, it } from 'vitest'
import { hasSecretConfigKey, hasSecretConfigValue, looksLikeSecretMaterial } from './secret-keys'

describe('hasSecretConfigKey', () => {
  it('detects nested secret-like keys', () => {
    expect(hasSecretConfigKey({ accounts: [{ apiToken: 'value' }] })).toBe(true)
    expect(hasSecretConfigKey({ oauth: { client_secret: 'value' } })).toBe(true)
  })

  it('allows metadata-only keys', () => {
    expect(hasSecretConfigKey({ provider: 's3', permissions: [{ permission: 'read' }] })).toBe(false)
  })
})

describe('hasSecretConfigValue', () => {
  it('detects nested raw secret material', () => {
    expect(hasSecretConfigValue({ reference: 'ghp_1234567890' })).toBe(true)
    expect(hasSecretConfigValue({ webhook: { value: 'xoxb-1234567890' } })).toBe(true)
    expect(hasSecretConfigValue({ certificate: '-----BEGIN PRIVATE KEY-----' })).toBe(true)
  })

  it('allows ordinary metadata values', () => {
    expect(hasSecretConfigValue({ region: 'us-east-1', buckets: ['assets'] })).toBe(false)
  })
})

describe('looksLikeSecretMaterial', () => {
  it('detects service account JSON material', () => {
    expect(looksLikeSecretMaterial(JSON.stringify({ private_key_id: 'abc123', client_email: 'deploy@example.com' }))).toBe(true)
  })
})
