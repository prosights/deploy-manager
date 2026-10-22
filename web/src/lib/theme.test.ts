import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useTheme } from './theme'

describe('useTheme', () => {
  it('defaults to light and cycles light → dark → system, saving each choice', () => {
    localStorage.clear()
    const { result } = renderHook(() => useTheme())
    expect(result.current[0]).toBe('light')

    act(() => result.current[1]())
    expect(result.current[0]).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('deploy-manager:theme')).toBe('"dark"')

    act(() => result.current[1]())
    expect(result.current[0]).toBe('system')
  })
})
