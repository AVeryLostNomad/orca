import type {
  GitStashApplyResult,
  GitStashDropResult,
  GitStashFilesResult,
  GitStashListResult,
  GitStashPushRequest,
  GitStashPushResult
} from '../../../shared/git-stash'
import { resolveLocalWorktreePath, type RuntimeGitContext } from './runtime-git-client-context'
import { callRuntimeRpc, getActiveRuntimeTarget } from './runtime-rpc-client'
import { toRuntimeWorktreeSelector } from './runtime-worktree-selector'

const STASH_RPC_TIMEOUT_MS = 30_000

export async function listRuntimeGitStashes(
  context: RuntimeGitContext
): Promise<GitStashListResult> {
  const target = getActiveRuntimeTarget(context.settings)
  if (target.kind === 'local' || !context.worktreeId) {
    return window.api.git.stashList({
      worktreePath: resolveLocalWorktreePath(context),
      connectionId: context.connectionId
    })
  }
  return callRuntimeRpc<GitStashListResult>(
    target,
    'git.stashList',
    { worktree: toRuntimeWorktreeSelector(context.worktreeId) },
    { timeoutMs: 15_000 }
  )
}

export async function listRuntimeGitStashFiles(
  context: RuntimeGitContext,
  sha: string
): Promise<GitStashFilesResult> {
  const target = getActiveRuntimeTarget(context.settings)
  if (target.kind === 'local' || !context.worktreeId) {
    return window.api.git.stashFiles({
      worktreePath: resolveLocalWorktreePath(context),
      sha,
      connectionId: context.connectionId
    })
  }
  return callRuntimeRpc<GitStashFilesResult>(
    target,
    'git.stashFiles',
    { worktree: toRuntimeWorktreeSelector(context.worktreeId), sha },
    { timeoutMs: 15_000 }
  )
}

export async function pushRuntimeGitStash(
  context: RuntimeGitContext,
  request: GitStashPushRequest
): Promise<GitStashPushResult> {
  const target = getActiveRuntimeTarget(context.settings)
  if (target.kind === 'local' || !context.worktreeId) {
    return window.api.git.stashPush({
      worktreePath: resolveLocalWorktreePath(context),
      request,
      connectionId: context.connectionId
    })
  }
  return callRuntimeRpc<GitStashPushResult>(
    target,
    'git.stashPush',
    { worktree: toRuntimeWorktreeSelector(context.worktreeId), request },
    { timeoutMs: STASH_RPC_TIMEOUT_MS }
  )
}

export async function applyRuntimeGitStash(
  context: RuntimeGitContext,
  sha: string
): Promise<GitStashApplyResult> {
  const target = getActiveRuntimeTarget(context.settings)
  if (target.kind === 'local' || !context.worktreeId) {
    return window.api.git.stashApply({
      worktreePath: resolveLocalWorktreePath(context),
      sha,
      connectionId: context.connectionId
    })
  }
  return callRuntimeRpc<GitStashApplyResult>(
    target,
    'git.stashApply',
    { worktree: toRuntimeWorktreeSelector(context.worktreeId), sha },
    { timeoutMs: STASH_RPC_TIMEOUT_MS }
  )
}

export async function dropRuntimeGitStash(
  context: RuntimeGitContext,
  sha: string
): Promise<GitStashDropResult> {
  const target = getActiveRuntimeTarget(context.settings)
  if (target.kind === 'local' || !context.worktreeId) {
    return window.api.git.stashDrop({
      worktreePath: resolveLocalWorktreePath(context),
      sha,
      connectionId: context.connectionId
    })
  }
  return callRuntimeRpc<GitStashDropResult>(
    target,
    'git.stashDrop',
    { worktree: toRuntimeWorktreeSelector(context.worktreeId), sha },
    { timeoutMs: STASH_RPC_TIMEOUT_MS }
  )
}
