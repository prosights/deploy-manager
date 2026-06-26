export function hasSecretConfigKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => hasSecretConfigKey(item))
  }
  if (!value || typeof value !== 'object') {
    return false
  }
  return Object.entries(value).some(([key, child]) => isSecretConfigKey(key) || hasSecretConfigKey(child))
}

export function hasSecretConfigValue(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => hasSecretConfigValue(item))
  }
  if (typeof value === 'string') {
    return looksLikeSecretMaterial(value)
  }
  if (!value || typeof value !== 'object') {
    return false
  }
  return Object.values(value).some((child) => hasSecretConfigValue(child))
}

export function looksLikeSecretMaterial(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) {
    return false
  }
  const upper = trimmed.toUpperCase()
  if (['-----BEGIN', 'PRIVATE KEY', 'BEGIN OPENSSH PRIVATE KEY', 'BEGIN RSA PRIVATE KEY'].some((marker) => upper.includes(marker))) {
    return true
  }
  const lower = trimmed.toLowerCase()
  if (['ghp_', 'github_pat_', 'xoxb-', 'sk_live_', 'sk_test_'].some((prefix) => lower.startsWith(prefix))) {
    return true
  }
  return looksLikeCredentialJSON(trimmed)
}

function isSecretConfigKey(key: string): boolean {
  const normalized = key.trim().toLowerCase().replaceAll('-', '_')
  const compact = normalized.replaceAll('_', '')
  return ['secret', 'token', 'password', 'private_key', 'api_key', 'client_secret', 'access_key', 'access_key_id'].some((part) => {
    const compactPart = part.replaceAll('_', '')
    return normalized.includes(part) || compact.includes(compactPart)
  })
}

function looksLikeCredentialJSON(value: string): boolean {
  if (!value.startsWith('{')) {
    return false
  }
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      return false
    }
    return ['private_key', 'private_key_id', 'client_secret', 'access_token', 'refresh_token'].some((key) => Object.hasOwn(parsed, key))
  } catch {
    return false
  }
}
