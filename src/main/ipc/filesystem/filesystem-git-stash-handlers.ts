import { ipcMain } from 'electron'
import type {
  GitStashApplyResult,
  GitStashDropResult,
  GitStashFilesResult,
  GitStashListResult,
  GitStashPushRequest,
  GitStashPushResult
} from '../../../shared/git-stash'
import { applyStash, dropStash, listStashFiles, listStashes, pushStash } from '../../git/stash'
import {
  getSshGitProvider,
  SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE
} from '../../providers/ssh-git-dispatch'
import { resolveRegisteredWorktreePath } from '../registered-worktree-roots-cache'
import { getLocalGitOptionsForRegisteredWorktree } from '../local-worktree-runtime-options'
import {
  validateFullGitObjectId,
  validateGitRelativeFilePath
} from '../filesystem-path-containment'
import type { FilesystemHandlerContext } from './filesystem-handler-context'

type StashWorktreeArgs = { worktreePath: string; connectionId?: string }

function requireSshProvider(connectionId: string) {
  const provider = getSshGitProvider(connectionId)
  if (!provider) {
    throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
  }
  return provider
}

export function registerFilesystemGitStashHandlers(context: FilesystemHandlerContext): void {
  const { store } = context

  async function resolveLocal(args: StashWorktreeArgs) {
    const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
    const gitOptions = getLocalGitOptionsForRegisteredWorktree(
      store,
      args.worktreePath,
      worktreePath
    )
    return {
      worktreePath,
      gitOptions: { ...gitOptions, admissionTier: 'interactive' as const }
    }
  }

  ipcMain.handle(
    'git:stashList',
    async (_event, args: StashWorktreeArgs): Promise<GitStashListResult> => {
      if (args.connectionId) {
        return requireSshProvider(args.connectionId).listStashes(args.worktreePath)
      }
      const { worktreePath, gitOptions } = await resolveLocal(args)
      return listStashes(worktreePath, gitOptions)
    }
  )

  ipcMain.handle(
    'git:stashFiles',
    async (_event, args: StashWorktreeArgs & { sha: string }): Promise<GitStashFilesResult> => {
      const sha = validateFullGitObjectId(args.sha, 'stash sha')
      if (args.connectionId) {
        return requireSshProvider(args.connectionId).listStashFiles(args.worktreePath, sha)
      }
      const { worktreePath, gitOptions } = await resolveLocal(args)
      return listStashFiles(worktreePath, sha, gitOptions)
    }
  )

  ipcMain.handle(
    'git:stashPush',
    async (
      _event,
      args: StashWorktreeArgs & { request: GitStashPushRequest }
    ): Promise<GitStashPushResult> => {
      if (args.connectionId) {
        return requireSshProvider(args.connectionId).pushStash(args.worktreePath, args.request)
      }
      const { worktreePath, gitOptions } = await resolveLocal(args)
      const paths = args.request.paths?.map((path) =>
        validateGitRelativeFilePath(worktreePath, path)
      )
      return pushStash(worktreePath, { ...args.request, paths }, gitOptions)
    }
  )

  ipcMain.handle(
    'git:stashApply',
    async (_event, args: StashWorktreeArgs & { sha: string }): Promise<GitStashApplyResult> => {
      const sha = validateFullGitObjectId(args.sha, 'stash sha')
      if (args.connectionId) {
        return requireSshProvider(args.connectionId).applyStash(args.worktreePath, sha)
      }
      const { worktreePath, gitOptions } = await resolveLocal(args)
      return applyStash(worktreePath, sha, gitOptions)
    }
  )

  ipcMain.handle(
    'git:stashDrop',
    async (_event, args: StashWorktreeArgs & { sha: string }): Promise<GitStashDropResult> => {
      const sha = validateFullGitObjectId(args.sha, 'stash sha')
      if (args.connectionId) {
        return requireSshProvider(args.connectionId).dropStash(args.worktreePath, sha)
      }
      const { worktreePath, gitOptions } = await resolveLocal(args)
      return dropStash(worktreePath, sha, gitOptions)
    }
  )
}
