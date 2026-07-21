import { describe, expect, it } from 'vitest'
import { blueGreenHealthCheckError } from './components'

describe('blueGreenHealthCheckError', () => {
  it('requires color and assigned-port placeholders', () => {
    expect(blueGreenHealthCheckError('http://127.0.0.1:{port}/healthz?color={color}')).toBe('')
    expect(blueGreenHealthCheckError('https://api-{color}.example.com/healthz')).toContain('{color} and {port}')
  })
})
