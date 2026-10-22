import type { Deployment } from './api'

export function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-')
}

export function optionalTrimmed(value: string): string | undefined {
  return value.trim() || undefined
}

export function formatTimestamp(value: string | null, fallback: string): string {
  return value ? new Date(value).toLocaleString() : fallback
}

export function formatRelativeTime(value: string): string {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return 'Recently'
  const seconds = Math.round((timestamp - Date.now()) / 1000)
  const absoluteSeconds = Math.abs(seconds)
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (absoluteSeconds < 60) return 'just now'
  if (absoluteSeconds < 3600) return formatter.format(Math.round(seconds / 60), 'minute')
  if (absoluteSeconds < 86_400) return formatter.format(Math.round(seconds / 3600), 'hour')
  if (absoluteSeconds < 604_800) return formatter.format(Math.round(seconds / 86_400), 'day')
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(timestamp)
}

export function formatFullTime(value: string): string {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return value
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp)
}

export function deploymentTitle(deployment: Deployment, fetchedMessage?: string): string {
  const fetchedSubject = commitSubject(fetchedMessage)
  if (fetchedSubject) return fetchedSubject
  const commitMessage = deployment.commit_message?.trim()
  if (commitMessage) return commitMessage
  if (deployment.commit_sha) return `Commit ${deployment.commit_sha.slice(0, 10)}`
  const imageRef = shortImageRef(deployment.image_ref)
  if (imageRef) return `Deploy ${imageRef}`
  return `Deployment ${deployment.id.slice(0, 8)}`
}

export function shortImageRef(imageRef: string | null): string | undefined {
  if (!imageRef) return undefined
  const image = imageRef.split('/').at(-1)
  return image && image.length > 28 ? `…${image.slice(-27)}` : image
}

function commitSubject(message?: string): string {
  return message?.split(/\r?\n/, 1)[0]?.trim() ?? ''
}
