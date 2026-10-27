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
import { requireReachableGitRoute } from '../../providers/execution-host-provider-dispatch'
import { getConnectionExecutionHostId } from '../../../shared/execution-host'
import { resolveRegisteredWorktreePath } from '../registered-worktree-roots-cache'
import { getLocalGitOptionsForRegisteredWorktree } from '../local-worktree-runtime-options'
import { validateFullGitObjectId, validateGitRelativeFilePath } from './filesystem-path-containment'
import type { FilesystemHandlerContext } from './filesystem-handler-context'

type StashWorktreeArgs = { worktreePath: string; connectionId?: string }

export function registerFilesystemGitStashHandlers(context: FilesystemHandlerContext): void {
  const { store } = context

  async function resolveLocal(args: StashWorktreeArgs) {
    // Why: SSH worktrees are served by the remote Orca server over runtime RPC, never here.
    requireReachableGitRoute(getConnectionExecutionHostId(args.connectionId))
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
      const { worktreePath, gitOptions } = await resolveLocal(args)
      return listStashes(worktreePath, gitOptions)
    }
  )

  ipcMain.handle(
    'git:stashFiles',
    async (_event, args: StashWorktreeArgs & { sha: string }): Promise<GitStashFilesResult> => {
      const sha = validateFullGitObjectId(args.sha, 'stash sha')
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
      const { worktreePath, gitOptions } = await resolveLocal(args)
      return applyStash(worktreePath, sha, gitOptions)
    }
  )

  ipcMain.handle(
    'git:stashDrop',
    async (_event, args: StashWorktreeArgs & { sha: string }): Promise<GitStashDropResult> => {
      const sha = validateFullGitObjectId(args.sha, 'stash sha')
      const { worktreePath, gitOptions } = await resolveLocal(args)
      return dropStash(worktreePath, sha, gitOptions)
    }
  )
}
