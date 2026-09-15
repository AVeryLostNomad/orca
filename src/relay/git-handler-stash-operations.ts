import {
  applyGitStash,
  dropGitStash,
  listGitStashFiles,
  listGitStashes,
  pushGitStash,
  type GitStashPushRequest
} from '../shared/git-stash'
import { GitHandlerOperationContext } from './git-handler-operation-context'

export class GitHandlerStashOperations extends GitHandlerOperationContext {
  async stashList(params: Record<string, unknown>) {
    return listGitStashes(this.git.bind(this), params.worktreePath as string)
  }

  async stashFiles(params: Record<string, unknown>) {
    return listGitStashFiles(
      this.git.bind(this),
      params.worktreePath as string,
      params.sha as string
    )
  }

  private async mutate<T>(run: () => Promise<T>): Promise<T> {
    this.clearGitMutationReadCaches()
    try {
      return await run()
    } finally {
      this.clearGitMutationReadCaches()
    }
  }

  stashPush(params: Record<string, unknown>) {
    const request = params.request as GitStashPushRequest
    return this.mutate(() =>
      pushGitStash(
        (args, cwd) => this.git(args, cwd, { nonInteractive: true }),
        params.worktreePath as string,
        request
      )
    )
  }

  stashApply(params: Record<string, unknown>) {
    return this.mutate(() =>
      applyGitStash(
        (args, cwd) => this.git(args, cwd, { nonInteractive: true }),
        params.worktreePath as string,
        params.sha as string
      )
    )
  }

  stashDrop(params: Record<string, unknown>) {
    return this.mutate(() =>
      dropGitStash(
        (args, cwd) => this.git(args, cwd, { nonInteractive: true }),
        params.worktreePath as string,
        params.sha as string
      )
    )
  }
}
