import { applyStash, dropStash, listStashFiles, listStashes, pushStash } from '../git/stash'
import type {
  GitStashApplyResult,
  GitStashDropResult,
  GitStashFilesResult,
  GitStashListResult,
  GitStashPushRequest,
  GitStashPushResult
} from '../../shared/git-stash'
import {
  localGitOptionsForTarget,
  normalizeRuntimeGitRelativePath,
  requireRuntimeGitProvider,
  type RuntimeGitCommandHost
} from './runtime-git-command-target'

export class RuntimeGitStashCommands {
  constructor(private readonly host: RuntimeGitCommandHost) {}

  async listRuntimeGitStashes(worktreeSelector: string): Promise<GitStashListResult> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const provider = requireRuntimeGitProvider(target)
    if (provider) {
      return provider.listStashes(target.worktree.path)
    }
    return listStashes(target.worktree.path, localGitOptionsForTarget(target))
  }

  async listRuntimeGitStashFiles(
    worktreeSelector: string,
    sha: string
  ): Promise<GitStashFilesResult> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const provider = requireRuntimeGitProvider(target)
    if (provider) {
      return provider.listStashFiles(target.worktree.path, sha)
    }
    return listStashFiles(target.worktree.path, sha, localGitOptionsForTarget(target))
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
    const provider = requireRuntimeGitProvider(target)
    if (provider) {
      return provider.pushStash(target.worktree.path, normalized)
    }
    return pushStash(target.worktree.path, normalized, localGitOptionsForTarget(target))
  }

  async applyRuntimeGitStash(worktreeSelector: string, sha: string): Promise<GitStashApplyResult> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const provider = requireRuntimeGitProvider(target)
    if (provider) {
      return provider.applyStash(target.worktree.path, sha)
    }
    return applyStash(target.worktree.path, sha, localGitOptionsForTarget(target))
  }

  async dropRuntimeGitStash(worktreeSelector: string, sha: string): Promise<GitStashDropResult> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const provider = requireRuntimeGitProvider(target)
    if (provider) {
      return provider.dropStash(target.worktree.path, sha)
    }
    return dropStash(target.worktree.path, sha, localGitOptionsForTarget(target))
  }
}
