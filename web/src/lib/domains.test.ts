import { describe, expect, it } from 'vitest'
import { validateDomain } from './domains'

describe('validateDomain', () => {
  it('allows normal DNS names', () => {
    expect(() => validateDomain('api.example.com')).not.toThrow()
  })

  it('rejects empty labels', () => {
    expect(() => validateDomain('api..example.com')).toThrow('Domain labels cannot be empty.')
  })

  it('rejects labels that start or end with hyphen', () => {
    expect(() => validateDomain('-api.example.com')).toThrow('Domain labels cannot start or end with hyphen.')
  })
})
