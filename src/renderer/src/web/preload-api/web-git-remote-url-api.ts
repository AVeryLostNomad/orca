import type { PreloadApi } from '../../../../preload/api-types'
import { toRuntimeWorktreeSelector } from '../../runtime/runtime-worktree-selector'
import { callRuntimeResult } from './web-runtime-calls'
import { resolveRuntimeWorktreeByPath } from './web-runtime-worktree-catalog'

type WebGitRemoteUrlApi = Pick<PreloadApi['git'], 'remoteFileUrl' | 'remoteCommitUrl'>

/** Browser-hosted lookups of the hosting provider's URL for a file line or commit. */
export function createWebGitRemoteUrlApi(): WebGitRemoteUrlApi {
  return {
    remoteFileUrl: async ({ worktreePath, relativePath, line }) => {
      const worktree = await resolveRuntimeWorktreeByPath(worktreePath)
      return callRuntimeResult('git.remoteFileUrl', {
        worktree: toRuntimeWorktreeSelector(worktree.id),
        relativePath,
        line
      })
    },
    remoteCommitUrl: async ({ worktreePath, sha }) => {
      const worktree = await resolveRuntimeWorktreeByPath(worktreePath)
      return callRuntimeResult('git.remoteCommitUrl', {
        worktree: toRuntimeWorktreeSelector(worktree.id),
        sha
      })
    }
  }
}
