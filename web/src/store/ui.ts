import { create } from 'zustand'

export type Theme = 'dark' | 'light' | 'system'

const themeOrder: Theme[] = ['light', 'dark', 'system']

export function nextTheme(current: Theme): Theme {
  const index = themeOrder.indexOf(current)
  return themeOrder[(index + 1) % themeOrder.length]
}

type UiState = {
  sidebarCollapsed: boolean
  searchQuery: string
  theme: Theme
  setSearchQuery: (searchQuery: string) => void
  toggleSidebar: () => void
  setTheme: (theme: Theme) => void
}

const themeStorageKey = 'theme'
const themePreferenceSourceKey = 'theme-preference-source'

function getInitialTheme(): Theme {
  const stored = localStorage.getItem(themeStorageKey)
  const hasUserPreference = localStorage.getItem(themePreferenceSourceKey) === 'user'
  if (hasUserPreference && isTheme(stored)) {
    return stored
  }
  return 'light'
}

function prefersLight(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: light)').matches
}

function applyTheme(theme: Theme, persist = false) {
  const root = document.documentElement
  const resolved = theme === 'system'
    ? (prefersLight() ? 'light' : 'dark')
    : theme

  root.classList.toggle('light', resolved === 'light')
  root.classList.toggle('dark', resolved === 'dark')
  if (persist) {
    localStorage.setItem(themeStorageKey, theme)
    localStorage.setItem(themePreferenceSourceKey, 'user')
  }
}

const initialTheme = getInitialTheme()
applyTheme(initialTheme)

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  searchQuery: '',
  theme: initialTheme,
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setTheme: (theme) => {
    applyTheme(theme, true)
    set({ theme })
  },
}))

// Always track the OS preference so that switching to 'system' at any time
// (not just on initial load) keeps the resolved theme in sync.
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (useUiStore.getState().theme === 'system') {
      applyTheme('system')
    }
  })
}

function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system'
}
