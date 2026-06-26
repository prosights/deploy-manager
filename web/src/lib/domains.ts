export function validateDomain(value: string): void {
  const domain = value.trim().toLowerCase()
  if (!domain) {
    throw new Error('Domain is required.')
  }
  if (domain.length > 253) {
    throw new Error('Domain is too long.')
  }
  if (!/^[a-z0-9.-]+$/.test(domain)) {
    throw new Error('Domain contains unsupported characters.')
  }
  for (const label of domain.split('.')) {
    if (!label) {
      throw new Error('Domain labels cannot be empty.')
    }
    if (label.length > 63) {
      throw new Error('Domain label is too long.')
    }
    if (label.startsWith('-') || label.endsWith('-')) {
      throw new Error('Domain labels cannot start or end with hyphen.')
    }
  }
}
