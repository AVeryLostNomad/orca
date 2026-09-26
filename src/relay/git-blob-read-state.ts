export type GitDiffReadState = 'present' | 'absent' | 'unavailable'

function getGitErrorText(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return ''
  }
  const { message, stderr } = error as { message?: unknown; stderr?: unknown }
  return [message, stderr]
    .filter(
      (value): value is string | Buffer => typeof value === 'string' || Buffer.isBuffer(value)
    )
    .map(String)
    .join('\n')
}

export function isProvenMissingGitBlob(error: unknown, gitPath: string, ref: string): boolean {
  if ((error as { code?: unknown } | null)?.code !== 128) {
    return false
  }
  const text = getGitErrorText(error)
  const mentionsGitPath = text.includes(`'${gitPath}'`) || text.includes(`"${gitPath}"`)
  if (!mentionsGitPath) {
    return false
  }
  if (ref === 'index') {
    return /\b(?:in the index|in index|neither on disk nor in the index)\b/i.test(text)
  }
  const mentionsGitRef = text.includes(`'${ref}'`) || text.includes(`"${ref}"`)
  return mentionsGitRef && /\b(?:does not exist|exists on disk, but not in)\b/i.test(text)
}
