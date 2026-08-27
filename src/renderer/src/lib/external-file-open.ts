import { toast } from 'sonner'
import { detectLanguage } from '@/lib/language-detect'
import { isPathInsideWorktree, toWorktreeRelativePath } from '@/lib/terminal-links'
import { useAppStore } from '@/store'
import { getConnectionId } from '@/lib/connection-context'
import { joinPath } from '@/lib/path'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import {
  importExternalPathsToRuntime,
  isRemoteRuntimeFileOperation,
  statRuntimePath,
  type RuntimeFileOperationArgs
} from '@/runtime/runtime-file-client'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import { translate } from '@/i18n/i18n'
import type { WorktreeRuntimeOwnerState } from '@/lib/worktree-runtime-owner'
import { captureWorktreeSshMutationExpectation } from '@/lib/ssh-mutation-expectation'

export function getEditorFileDropSettingsForWorktree(
  store: WorktreeRuntimeOwnerState,
  worktreeId: string
): Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> {
  const runtimeEnvironmentId = getRuntimeEnvironmentIdForWorktree(store, worktreeId)
  // Why: OS drops target the selected worktree. Use that worktree's host owner
  // so a focused runtime cannot hijack local/SSH editor drops.
  return {
    ...store.settings,
    activeRuntimeEnvironmentId: runtimeEnvironmentId
  }
}

export function shouldUploadRemoteEditorFileDrop(
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined,
  connectionId: string | null | undefined
): boolean {
  return Boolean(settings?.activeRuntimeEnvironmentId?.trim() || connectionId?.trim())
}

export function getEditorFileDropOperationContext(
  store: WorktreeRuntimeOwnerState,
  worktreeId: string,
  worktreePath: string | null | undefined,
  connectionId: string | undefined
): RuntimeFileOperationArgs {
  return {
    settings: getEditorFileDropSettingsForWorktree(store, worktreeId),
    worktreeId,
    worktreePath,
    connectionId
  }
}

/**
 * Opens OS-provided local file paths as editor tabs in the active workspace —
 * the shared path for tab-strip drops and OS "open with" launches. Remote-owned
 * workspaces get the files uploaded into `.orca/drops` first.
 */
export function openExternalPathsInActiveWorkspace(
  paths: string[],
  options?: { notifyWhenNoWorkspace?: boolean }
): void {
  if (paths.length === 0) {
    return
  }
  const store = useAppStore.getState()
  const activeWorktreeId = store.activeWorktreeId
  if (!activeWorktreeId) {
    if (options?.notifyWhenNoWorkspace) {
      toast.error(
        translate(
          'auto.lib.externalFileOpen.noActiveWorkspace',
          'Open a workspace in Orca first, then open the file again.'
        )
      )
    }
    return
  }

  const activeWorktree = store.getKnownWorktreeById(activeWorktreeId)
  const worktreePath = activeWorktree?.path
  const connectionId = getConnectionId(activeWorktreeId) ?? undefined
  let fileContext: RuntimeFileOperationArgs
  try {
    fileContext = {
      ...getEditorFileDropOperationContext(store, activeWorktreeId, worktreePath, connectionId),
      ...captureWorktreeSshMutationExpectation(store, activeWorktreeId)
    }
  } catch {
    toast.error(
      translate(
        'auto.hooks.useGlobalFileDrop.ownerChanged',
        "Couldn't verify which host owns this workspace. Try again after it reconnects."
      )
    )
    return
  }
  const dropSettings = fileContext.settings
  const runtimeEnvironmentId = dropSettings?.activeRuntimeEnvironmentId ?? null
  if (shouldUploadRemoteEditorFileDrop(dropSettings, connectionId)) {
    if (!worktreePath) {
      toast.error(
        translate(
          'auto.hooks.useGlobalFileDrop.245faa95b9',
          'No remote workspace path is available for dropped files.'
        )
      )
      return
    }
    void (async () => {
      try {
        // Why: OS file drops provide client-local paths. Remote runtime and
        // SSH editors must upload into the server worktree before opening.
        const destinationDir = joinPath(worktreePath, '.orca/drops')
        const { results } = await importExternalPathsToRuntime(fileContext, paths, destinationDir, {
          ensureDestinationDir: true
        })
        const imported = results.filter((result) => result.status === 'imported')
        for (const result of imported) {
          if (result.kind === 'directory') {
            continue
          }
          const maybeRelative = toWorktreeRelativePath(result.destPath, worktreePath)
          store.setActiveTabType('editor')
          store.openFile(
            {
              filePath: result.destPath,
              relativePath: maybeRelative ?? result.destPath,
              worktreeId: activeWorktreeId,
              runtimeEnvironmentId: runtimeEnvironmentId ?? undefined,
              language: detectLanguage(result.destPath),
              mode: 'edit'
            },
            { suppressActiveRuntimeFallback: runtimeEnvironmentId === null }
          )
        }
        if (results.some((result) => result.status !== 'imported')) {
          toast.error(
            translate(
              'auto.hooks.useGlobalFileDrop.d720e2f855',
              'Some dropped files could not be uploaded.'
            )
          )
        }
      } catch {
        toast.error(
          translate('auto.hooks.useGlobalFileDrop.38c9f034ff', 'Failed to upload dropped files.')
        )
      }
    })()
    return
  }

  // Why: the relay payload now sends all paths in one gesture-scoped event.
  // Loop over every dropped file so multi-file editor drops still open
  // each file, matching the prior per-path behavior.
  for (const filePath of paths) {
    void (async () => {
      try {
        const isRemoteRuntimePath = isRemoteRuntimeFileOperation(fileContext, filePath)
        // Why: remote paths don't need local auth — the relay/runtime is the security boundary.
        if (!connectionId && !isRemoteRuntimePath) {
          await window.api.fs.authorizeExternalPath({ targetPath: filePath })
        }
        const stat = await statRuntimePath(fileContext, filePath)
        if (stat.isDirectory) {
          return
        }

        let relativePath = filePath
        if (worktreePath && isPathInsideWorktree(filePath, worktreePath)) {
          const maybeRelative = toWorktreeRelativePath(filePath, worktreePath)
          if (maybeRelative !== null && maybeRelative.length > 0) {
            relativePath = maybeRelative
          }
        }

        // Why: the preload bridge already proved this OS drop landed on the
        // tab-strip editor target. Keeping the editor-open path centralized
        // here avoids the regression where CLI drops were all coerced into
        // editor tabs once the renderer lost the original drop surface.
        store.setActiveTabType('editor')
        store.openFile({
          filePath,
          relativePath,
          worktreeId: activeWorktreeId,
          language: detectLanguage(filePath),
          mode: 'edit'
        })
      } catch {
        // Ignore files that cannot be authorized or stat'd.
      }
    })()
  }
}
