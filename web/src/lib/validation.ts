export function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
}

export function validateRemoteDirectory(value: string): void {
  const directory = value.trim()
  if (!directory.startsWith('/') || directory === '/' || directory.includes('//') || directory.split('/').includes('..') || hasControlCharacters(directory)) throw new Error('Remote directory must be a safe absolute path below root.')
}

export function validateGitBranch(value: string): void {
  const branch = value.trim()
  if (!branch || branch.startsWith('-') || branch.startsWith('/') || branch.endsWith('/') || branch.includes('//') || branch.includes('..') || branch.includes('@{') || branch.endsWith('.lock') || !/^[A-Za-z0-9/._-]+$/.test(branch)) throw new Error('Branch is not a safe git ref.')
}

export function validateComposePath(value: string): void {
  const path = value.trim()
  if (!path || path.startsWith('/') || path === '.' || path.split('/').includes('..') || hasControlCharacters(path)) throw new Error('Compose path must be a safe relative file path.')
}

export function validateRepositoryRoot(value: string): void {
  const root = value.trim()
  if (!root || root === '.') return
  if (root.startsWith('/') || root.endsWith('/') || root.includes('//') || root.split('/').includes('..') || hasControlCharacters(root)) throw new Error('Root directory must be a safe relative path.')
}

export function validateRepositoryURL(value: string): void {
  const repository = value.trim()
  if (!repository) return
  if (/^git@github\.com:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(repository)) return
  if (/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\.git)?$/.test(repository)) return
  throw new Error('Repository URL must be a GitHub owner/repository remote.')
}

export function validateDopplerScope(project: string, config: string): void {
  if (Boolean(project.trim()) !== Boolean(config.trim())) throw new Error('Doppler project and config must be provided together.')
  if (hasControlCharacters(project) || hasControlCharacters(config)) throw new Error('Doppler scope cannot contain control characters.')
}
