import { getRepoExecutionHostId, LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'

/** Merge/Rebase into a target runs local Git only: linked worktrees on a branch in a local git project. */
export function canMergeWorktreeIntoTarget(args: {
  // Why optional: folder/placeholder rows can arrive without a branch; they are never mergeable.
  worktree: Pick<Worktree, 'isMainWorktree' | 'hostId'> & { branch?: string | null }
  repo: Pick<Repo, 'connectionId' | 'executionHostId'> | null | undefined
  folderWorkspaceId: string | null
}): boolean {
  const { worktree, repo } = args
  return (
    !!repo &&
    !args.folderWorkspaceId &&
    !worktree.isMainWorktree &&
    (worktree.branch ?? '').startsWith('refs/heads/') &&
    getRepoExecutionHostId(repo) === LOCAL_EXECUTION_HOST_ID &&
    (worktree.hostId ?? LOCAL_EXECUTION_HOST_ID) === LOCAL_EXECUTION_HOST_ID
  )
}
