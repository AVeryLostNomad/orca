import type {
  GitStashApplyResult,
  GitStashDropResult,
  GitStashFilesResult,
  GitStashListResult,
  GitStashPushRequest,
  GitStashPushResult
} from '../../shared/git-stash'
import {
  normalizeRuntimeGitRelativePath,
  requireRuntimeGitProvider,
  type RuntimeGitCommandHost
} from './runtime-git-command-target'

export class RuntimeGitStashCommands {
  constructor(private readonly host: RuntimeGitCommandHost) {}

  async listRuntimeGitStashes(worktreeSelector: string): Promise<GitStashListResult> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    return requireRuntimeGitProvider(target).listStashes(target.worktree.path)
  }

  async listRuntimeGitStashFiles(
    worktreeSelector: string,
    sha: string
  ): Promise<GitStashFilesResult> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    return requireRuntimeGitProvider(target).listStashFiles(target.worktree.path, sha)
  }

  async pushRuntimeGitStash(
    worktreeSelector: string,
    request: GitStashPushRequest
  ): Promise<GitStashPushResult> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const normalized: GitStashPushRequest = {
      ...request,
      paths: request.paths?.map((path) => normalizeRuntimeGitRelativePath(path))
    }
    return requireRuntimeGitProvider(target).pushStash(target.worktree.path, normalized)
  }

  async applyRuntimeGitStash(worktreeSelector: string, sha: string): Promise<GitStashApplyResult> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    return requireRuntimeGitProvider(target).applyStash(target.worktree.path, sha)
  }

  async dropRuntimeGitStash(worktreeSelector: string, sha: string): Promise<GitStashDropResult> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    return requireRuntimeGitProvider(target).dropStash(target.worktree.path, sha)
  }
}
