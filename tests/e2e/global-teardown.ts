/**
 * Playwright globalTeardown: cleans up the test git repo and worktrees.
 *
 * Why: the temp repo created by globalSetup should be removed after the
 * test run so we don't litter the user's /tmp with test directories.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, rmSync, readdirSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { TEST_REPO_PATH_FILE } from './global-setup'

function isWorktreeOfRepo(repoDir: string, candidateDir: string): boolean {
  try {
    const registered = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: repoDir,
      encoding: 'utf8',
      stdio: 'pipe'
    })
      .split('\n')
      .filter((line) => line.startsWith('worktree '))
      .map((line) => line.slice('worktree '.length).trim())
    const resolved = realpathSync(candidateDir)
    return registered.some((registeredPath) => {
      try {
        return realpathSync(registeredPath) === resolved
      } catch {
        return registeredPath === resolved
      }
    })
  } catch {
    return false
  }
}

export default function globalTeardown(): void {
  if (!existsSync(TEST_REPO_PATH_FILE)) {
    return
  }

  const testRepoDir = readFileSync(TEST_REPO_PATH_FILE, 'utf-8').trim()
  if (testRepoDir && existsSync(testRepoDir)) {
    // Why: git worktree add creates directories as siblings. The repo lives in a
    // per-run parent dir, so removing that dir cleans every sibling worktree
    // without touching other concurrent runs' fixtures (which the old
    // name-prefix scan over the shared os.tmpdir() used to delete mid-run).
    const parentDir = path.dirname(testRepoDir)
    if (path.basename(parentDir).startsWith('orca-e2e-run-')) {
      rmSync(parentDir, { recursive: true, force: true })
    } else {
      // Legacy layout (user-provided repo path): scope sibling cleanup to this
      // repo's registered worktrees instead of every prefix-matched dir in tmp.
      try {
        const siblings = readdirSync(parentDir)
        for (const name of siblings) {
          if (name.startsWith('orca-e2e-worktree-') || name.startsWith('e2e-test-')) {
            const candidate = path.join(parentDir, name)
            if (isWorktreeOfRepo(testRepoDir, candidate)) {
              rmSync(candidate, { recursive: true, force: true })
            }
          }
        }
      } catch {
        // Best-effort cleanup of worktrees
      }
      rmSync(testRepoDir, { recursive: true, force: true })
    }
    console.error(`[e2e] Cleaned up test repo at ${testRepoDir}`)
  }

  rmSync(TEST_REPO_PATH_FILE, { force: true })
}
