import type { PreloadApi } from '../../../../preload/api-types'
import type {
  GitStashApplyResult,
  GitStashDropResult,
  GitStashFilesResult,
  GitStashListResult,
  GitStashPushResult
} from '../../../../shared/git-stash'
import { toRuntimeWorktreeSelector } from '../../runtime/runtime-worktree-selector'
import { callRuntimeResult } from './web-runtime-calls'
import { resolveRuntimeWorktreeByPath } from './web-runtime-worktree-catalog'

type WebGitStashApi = Pick<
  PreloadApi['git'],
  'stashList' | 'stashFiles' | 'stashPush' | 'stashApply' | 'stashDrop'
>

/** Browser-hosted stash operations: each resolves the worktree selector, then calls the runtime RPC. */
export function createWebGitStashApi(): WebGitStashApi {
  return {
    stashList: async ({ worktreePath }) => {
      const worktree = await resolveRuntimeWorktreeByPath(worktreePath)
      return callRuntimeResult<GitStashListResult>('git.stashList', {
        worktree: toRuntimeWorktreeSelector(worktree.id)
      })
    },
    stashFiles: async ({ worktreePath, sha }) => {
      const worktree = await resolveRuntimeWorktreeByPath(worktreePath)
      return callRuntimeResult<GitStashFilesResult>('git.stashFiles', {
        worktree: toRuntimeWorktreeSelector(worktree.id),
        sha
      })
    },
    stashPush: async ({ worktreePath, request }) => {
      const worktree = await resolveRuntimeWorktreeByPath(worktreePath)
      return callRuntimeResult<GitStashPushResult>('git.stashPush', {
        worktree: toRuntimeWorktreeSelector(worktree.id),
        request
      })
    },
    stashApply: async ({ worktreePath, sha }) => {
      const worktree = await resolveRuntimeWorktreeByPath(worktreePath)
      return callRuntimeResult<GitStashApplyResult>('git.stashApply', {
        worktree: toRuntimeWorktreeSelector(worktree.id),
        sha
      })
    },
    stashDrop: async ({ worktreePath, sha }) => {
      const worktree = await resolveRuntimeWorktreeByPath(worktreePath)
      return callRuntimeResult<GitStashDropResult>('git.stashDrop', {
        worktree: toRuntimeWorktreeSelector(worktree.id),
        sha
      })
    }
  }
}
