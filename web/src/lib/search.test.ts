import { describe, expect, it } from 'vitest'
import { matchesSearch } from './search'

describe('matchesSearch', () => {
  it('matches case-insensitive primitive values', () => {
    expect(matchesSearch('PROD', ['prod-1', '10.0.0.10'])).toBe(true)
    expect(matchesSearch('worker', ['prod-1', '10.0.0.10'])).toBe(false)
  })

  it('matches nested metadata objects', () => {
    expect(matchesSearch('blue_green', [{ strategy: 'blue_green', commit_sha: 'abc1234' }])).toBe(true)
  })

  it('treats blank search as a match', () => {
    expect(matchesSearch(' ', [])).toBe(true)
  })
})
