import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { GitAuthorIdentity } from '../../shared/git-author-identity'
import { gitExecFileAsync } from './runner'

export const GIT_IDENTITY_MISSING_ERROR =
  'Git author identity is not configured. Connect a GitHub account in Orca or configure Git author identity on this host, then try again.'

/**
 * `git init` plus an empty initial commit so HEAD has a branch ref for worktrees.
 * Returns an error message, or null on success. Rolls back what it created on failure.
 */
export async function initializeEmptyGitRepo(
  targetPath: string,
  createdDir: boolean,
  authorIdentity?: GitAuthorIdentity
): Promise<string | null> {
  let step: 'init' | 'commit' = 'init'
  try {
    await gitExecFileAsync(['init'], { cwd: targetPath })
    step = 'commit'
    if (authorIdentity) {
      await gitExecFileAsync(['config', 'user.name', authorIdentity.name], {
        cwd: targetPath
      })
      await gitExecFileAsync(['config', 'user.email', authorIdentity.email], {
        cwd: targetPath
      })
    }
    await gitExecFileAsync(['commit', '--allow-empty', '-m', 'Initial commit'], {
      cwd: targetPath,
      ...(authorIdentity
        ? {
            env: {
              ...process.env,
              GIT_AUTHOR_NAME: authorIdentity.name,
              GIT_AUTHOR_EMAIL: authorIdentity.email,
              GIT_COMMITTER_NAME: authorIdentity.name,
              GIT_COMMITTER_EMAIL: authorIdentity.email
            }
          }
        : {})
    })
    return null
  } catch (error) {
    if (createdDir) {
      await rm(targetPath, { recursive: true, force: true }).catch(() => {})
    } else if (step === 'commit') {
      await rm(join(targetPath, '.git'), {
        recursive: true,
        force: true
      }).catch(() => {})
    }
    const message = error instanceof Error ? error.message : String(error)
    if (step === 'commit' && /Please tell me who you are|user\.name|user\.email/i.test(message)) {
      return GIT_IDENTITY_MISSING_ERROR
    }
    const label =
      step === 'init' ? 'Failed to initialize git repository' : 'Failed to create initial commit'
    return `${label}: ${message}`
  }
}
