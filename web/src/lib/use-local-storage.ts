import { useState } from 'react'

// State that survives reloads: read once on mount, written on every update.
// `validate` checks the stored value and returns undefined when it is missing
// or no longer valid, in which case `fallback` is used.
export function useLocalStorage<T>(key: string, fallback: T, validate: (stored: unknown) => T | undefined) {
  const [value, setValue] = useState<T>(() => validate(readStored(key)) ?? fallback)

  function update(next: T) {
    localStorage.setItem(key, JSON.stringify(next))
    setValue(next)
  }

  return [value, update] as const
}

function readStored(key: string): unknown {
  const stored = localStorage.getItem(key)
  if (stored === null) return undefined
  try {
    return JSON.parse(stored)
  } catch {
    return undefined
  }
}
