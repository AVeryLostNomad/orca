/** How a worktree's branch lands on its target: a merge, or a rebase followed by a fast-forward. */
export type WorktreeMergeMode = 'merge' | 'rebase'

export type WorktreeMergeIntoTargetArgs = {
  worktreePath: string
  /** Local (`stable`) or remote (`origin/stable`) ref; remote refs land on the local branch of the same name. */
  targetRef: string
  mode: WorktreeMergeMode
}

export type WorktreeMergeIntoTargetResult = {
  sourceBranch: string
  targetBranch: string
  newTargetSha: string
}
