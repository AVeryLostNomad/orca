import type {
  GitStashApplyResult,
  GitStashDropResult,
  GitStashFilesResult,
  GitStashListResult,
  GitStashPushRequest,
  GitStashPushResult
} from '../../../shared/git-stash'
import { resolveLocalWorktreePath, type RuntimeGitContext } from './runtime-git-client-context'
import { callRuntimeRpc } from './runtime-rpc-client'
import { RuntimeRpcCallError } from './runtime-rpc-result'
import { translate } from '@/i18n/i18n'
import { toRuntimeWorktreeSelector } from './runtime-worktree-selector'

const STASH_RPC_TIMEOUT_MS = 30_000

/** Remote servers without the stash RPCs answer method_not_found; name the fix instead of the code. */
async function callStashRpc<TResult>(...args: Parameters<typeof callRuntimeRpc>): Promise<TResult> {
  try {
    return await callRuntimeRpc<TResult>(...args)
  } catch (error) {
    if (error instanceof RuntimeRpcCallError && error.code === 'method_not_found') {
      throw new Error(
        translate(
          'auto.runtime.runtimeGitStashClient.serverOutOfDate',
          'The remote Orca server is out of date and does not support stashes. Update it to use stashes.'
        )
      )
    }
    throw error
  }
}

export async function listRuntimeGitStashes(
  context: RuntimeGitContext
): Promise<GitStashListResult> {
  const target = context.target
  if (target.kind === 'local' || !context.worktreeId) {
    return window.api.git.stashList({
      worktreePath: resolveLocalWorktreePath(context),
      connectionId: context.connectionId
    })
  }
  return callStashRpc<GitStashListResult>(
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
  const target = context.target
  if (target.kind === 'local' || !context.worktreeId) {
    return window.api.git.stashFiles({
      worktreePath: resolveLocalWorktreePath(context),
      sha,
      connectionId: context.connectionId
    })
  }
  return callStashRpc<GitStashFilesResult>(
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
  const target = context.target
  if (target.kind === 'local' || !context.worktreeId) {
    return window.api.git.stashPush({
      worktreePath: resolveLocalWorktreePath(context),
      request,
      connectionId: context.connectionId
    })
  }
  return callStashRpc<GitStashPushResult>(
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
  const target = context.target
  if (target.kind === 'local' || !context.worktreeId) {
    return window.api.git.stashApply({
      worktreePath: resolveLocalWorktreePath(context),
      sha,
      connectionId: context.connectionId
    })
  }
  return callStashRpc<GitStashApplyResult>(
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
  const target = context.target
  if (target.kind === 'local' || !context.worktreeId) {
    return window.api.git.stashDrop({
      worktreePath: resolveLocalWorktreePath(context),
      sha,
      connectionId: context.connectionId
    })
  }
  return callStashRpc<GitStashDropResult>(
    target,
    'git.stashDrop',
    { worktree: toRuntimeWorktreeSelector(context.worktreeId), sha },
    { timeoutMs: STASH_RPC_TIMEOUT_MS }
  )
}
