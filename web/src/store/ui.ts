import { create } from 'zustand'

type Theme = 'dark' | 'light' | 'system'

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

function applyTheme(theme: Theme, persist = false) {
  const root = document.documentElement
  const resolved = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
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

if (getInitialTheme() === 'system') {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    const current = useUiStore.getState().theme
    if (current === 'system') {
      applyTheme('system')
    }
  })
}

function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system'
}
