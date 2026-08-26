export type GitAuthorIdentity = {
  name: string
  email: string
}

const EMAIL = /^[^\s@]+@[^\s@]+$/

export function normalizeGitAuthorIdentity(value: unknown): GitAuthorIdentity | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const candidate = value as { name?: unknown; email?: unknown }
  if (typeof candidate.name !== 'string' || typeof candidate.email !== 'string') {
    return null
  }
  const name = candidate.name.trim()
  const email = candidate.email.trim()
  const hasControlCharacter = Array.from(`${name}${email}`).some(
    (character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127
  )
  if (
    !name ||
    name.length > 256 ||
    hasControlCharacter ||
    email.length > 320 ||
    !EMAIL.test(email)
  ) {
    return null
  }
  return { name, email }
}
