import { describe, expect, it } from 'vitest'

describe('ui store', () => {
  it('defaults new sessions to light theme', async () => {
    localStorage.removeItem('theme')
    localStorage.removeItem('theme-preference-source')
    document.documentElement.className = ''

    const modulePath = `./ui.ts?default-theme-${Date.now()}`
    const { useUiStore } = await import(modulePath)

    expect(useUiStore.getState().theme).toBe('light')
    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(localStorage.getItem('theme')).toBeNull()
  })

  it('ignores stale dark defaults from earlier app loads', async () => {
    localStorage.setItem('theme', 'dark')
    localStorage.removeItem('theme-preference-source')
    document.documentElement.className = ''

    const modulePath = `./ui.ts?stale-dark-${Date.now()}`
    const { useUiStore } = await import(modulePath)

    expect(useUiStore.getState().theme).toBe('light')
    expect(document.documentElement.classList.contains('light')).toBe(true)
  })

  it('persists explicit user theme choices', async () => {
    localStorage.removeItem('theme')
    localStorage.removeItem('theme-preference-source')
    document.documentElement.className = ''

    const modulePath = `./ui.ts?user-theme-${Date.now()}`
    const { useUiStore } = await import(modulePath)
    useUiStore.getState().setTheme('dark')

    expect(useUiStore.getState().theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('theme')).toBe('dark')
    expect(localStorage.getItem('theme-preference-source')).toBe('user')
  })
})
