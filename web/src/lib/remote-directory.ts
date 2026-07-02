export function suggestedRemoteDirectory(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug ? `/srv/deploy-manager/apps/${slug}` : ''
}
