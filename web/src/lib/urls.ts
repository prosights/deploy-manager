export function validateHealthCheckURL(value: string): void {
  const healthCheckURL = value.trim()
  if (!healthCheckURL) {
    return
  }
  if (healthCheckURL.includes('\n') || healthCheckURL.includes('\r') || healthCheckURL.includes('\t')) {
    throw new Error('Health check URL cannot contain control characters.')
  }
  let parsed: URL
  try {
    parsed = new URL(healthCheckURL.replaceAll('{color}', 'blue').replaceAll('{port}', '3101'))
  } catch {
    throw new Error('Health check URL must be an absolute HTTP URL.')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Health check URL must use http or https.')
  }
  if (!parsed.host) {
    throw new Error('Health check URL must include a host.')
  }
  if (parsed.username || parsed.password) {
    throw new Error('Health check URL cannot include credentials.')
  }
}
