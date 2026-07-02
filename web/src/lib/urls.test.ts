import { describe, expect, it } from 'vitest'
import { validateHealthCheckURL } from './urls'

describe('validateHealthCheckURL', () => {
  it('allows absolute http health check URLs with color placeholders', () => {
    expect(() => validateHealthCheckURL('https://api.example.com/{color}/health')).not.toThrow()
  })

  it('allows blue-green local health checks with port placeholders', () => {
    expect(() => validateHealthCheckURL('http://127.0.0.1:{port}/healthz?color={color}')).not.toThrow()
  })

  it('rejects health check URLs with embedded credentials', () => {
    expect(() => validateHealthCheckURL('https://user:pass@example.com/{color}/health')).toThrow('Health check URL cannot include credentials.')
  })
})
