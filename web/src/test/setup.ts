import '@testing-library/jest-dom/vitest'

// Node 24 exposes an incomplete global Web Storage object unless a persistence
// file is configured. Keep tests on a small in-memory browser-compatible store.
const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    clear: () => storage.clear(),
    getItem: (key: string) => storage.get(key) ?? null,
    key: (index: number) => [...storage.keys()][index] ?? null,
    get length() { return storage.size },
    removeItem: (key: string) => { storage.delete(key) },
    setItem: (key: string, value: string) => { storage.set(key, String(value)) },
  } satisfies Storage,
})

Element.prototype.scrollIntoView = () => undefined
