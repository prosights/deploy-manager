import { useLocalStorage } from './use-local-storage'

export type Theme = 'light' | 'dark' | 'system'

const storageKey = 'deploy-manager:theme'
const themes: Theme[] = ['light', 'dark', 'system']
const systemLight = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: light)') : undefined

function validTheme(value: unknown): Theme | undefined {
  return themes.find((theme) => theme === value)
}

function applyTheme(theme: Theme) {
  const resolved = theme === 'system' ? (systemLight?.matches ? 'light' : 'dark') : theme
  document.documentElement.classList.toggle('light', resolved === 'light')
  document.documentElement.classList.toggle('dark', resolved === 'dark')
}

function currentTheme(): Theme {
  try {
    return validTheme(JSON.parse(localStorage.getItem(storageKey) ?? 'null')) ?? 'light'
  } catch {
    return 'light'
  }
}

// Apply the saved theme before React renders, and follow the OS while the
// theme is 'system'.
applyTheme(currentTheme())
systemLight?.addEventListener('change', () => applyTheme(currentTheme()))

export function useTheme() {
  const [theme, setTheme] = useLocalStorage<Theme>(storageKey, 'light', validTheme)
  function cycleTheme() {
    const next = themes[(themes.indexOf(theme) + 1) % themes.length]
    applyTheme(next)
    setTheme(next)
  }
  return [theme, cycleTheme] as const
}
