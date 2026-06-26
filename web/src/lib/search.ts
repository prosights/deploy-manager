export function matchesSearch(query: string, values: Array<unknown>): boolean {
  const needle = normalizeSearchValue(query)
  if (!needle) {
    return true
  }
  return values.some((value) => normalizeSearchValue(value).includes(needle))
}

function normalizeSearchValue(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  if (typeof value === 'object') {
    return JSON.stringify(value).toLowerCase()
  }
  return String(value).trim().toLowerCase()
}
