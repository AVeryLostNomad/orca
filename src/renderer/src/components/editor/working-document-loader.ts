import { useAppStore } from '@/store'
import {
  buildWorkingDocumentTarget,
  type WorkingDocument,
  type WorkingDocumentId
} from '@/store/slices/editor/working-document'
import type { AppState } from '@/store/types'
import type { OpenFile } from '@/store/slices/editor'
import { getEditorFileOperationContext } from '@/lib/editor-file-operation-owner'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { selectWorktreesByRepo } from '@/store/workspace-record-selectors'
import { readRuntimeFileContent } from '@/runtime/runtime-file-read-client'
import { getDiskBaselineSignature } from './diff-content-signature'
import type { FileContent } from './editor-panel-content-types'
import type { RuntimeFileReadArgs } from '@/runtime/runtime-file-client-types'

/** Tab-scoped read authority (local access, host grants, WSL wake) that the document target lacks. */
export type WorkingDocumentReadArgs = Partial<
  Pick<
    RuntimeFileReadArgs,
    'access' | 'terminalArtifactGrantId' | 'expectedEnvironmentPairingRevision' | 'wakeWslDistro'
  >
>

/** Editable tabs share one canonical working document per owner/path, retained by every tab of the file. */
export function retainEditableTabDocument(
  state: AppState,
  file: OpenFile
): WorkingDocumentId | undefined {
  // Paged CSV previews hold placeholder data that must never become an editable document.
  if (file.readOnly || file.csvPreviewOnly === true) {
    return undefined
  }
  const memberTabIds = Object.values(state.unifiedTabsByWorktree).flatMap((tabs) =>
    tabs.filter((tab) => tab.entityId === file.id).map((tab) => tab.id)
  )
  return (memberTabIds.length ? memberTabIds : [file.id]).map((tabId) =>
    state.retainWorkingDocument(tabId, buildWorkingDocumentTarget(state, file))
  )[0]
}

const pendingLoads = new Map<
  WorkingDocumentId,
  { document: WorkingDocument; promise: Promise<FileContent>; externalEventGeneration?: number }
>()

export function loadWorkingDocument(
  id: WorkingDocumentId,
  options?: {
    force?: boolean
    externalEventGeneration?: number
    readArgs?: WorkingDocumentReadArgs
  }
): Promise<FileContent> {
  const state = useAppStore.getState()
  const document = state.workingDocuments[id]
  if (!document) {
    return Promise.reject(new Error('The working document is no longer retained.'))
  }
  if (!options?.force && document.loadState === 'ready' && document.content !== undefined) {
    return Promise.resolve({ content: document.content, isBinary: false })
  }
  const pending = pendingLoads.get(id)
  if (pending && !options?.force && pending.document === document) {
    return pending.promise
  }
  // Why: the controller and a mounted panel both force-reload on the same external event.
  if (
    pending &&
    options?.externalEventGeneration !== undefined &&
    pending.externalEventGeneration === options.externalEventGeneration
  ) {
    return pending.promise
  }
  const { target, revision } = document
  const promise: Promise<FileContent> = Promise.resolve().then(async (): Promise<FileContent> => {
    try {
      const worktree = findWorktreeById(selectWorktreesByRepo(state), target.worktreeId)
      const context = getEditorFileOperationContext(
        state,
        {
          ...target,
          runtimeEnvironmentId: target.owner.runtimeEnvironmentId
        },
        worktree?.path ?? null
      )
      if (document.loadState !== 'ready') {
        state.setWorkingDocumentLoadState(id, revision, 'loading')
      }
      const result = await readRuntimeFileContent({
        target: context.target,
        filePath: target.filePath,
        relativePath: target.relativePath,
        worktreeId: target.worktreeId,
        connectionId: context.connectionId,
        expectedExternalSshTargetId: target.externalSshTargetId,
        ...options?.readArgs
      })
      if (pendingLoads.get(id)?.promise !== promise) {
        return result
      }
      if (result.isBinary) {
        useAppStore
          .getState()
          .setWorkingDocumentLoadState(
            id,
            revision,
            'error',
            'Binary files cannot be edited as text.'
          )
      } else {
        const current = useAppStore.getState()
        getEditorFileOperationContext(
          current,
          { ...target, runtimeEnvironmentId: target.owner.runtimeEnvironmentId },
          worktree?.path ?? null
        )
        current.acceptWorkingDocumentLoad(
          id,
          revision,
          result.content,
          getDiskBaselineSignature(result.content)
        )
      }
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (pendingLoads.get(id)?.promise === promise) {
        useAppStore.getState().setWorkingDocumentLoadState(id, revision, 'error', message)
      }
      throw error
    } finally {
      if (pendingLoads.get(id)?.promise === promise) {
        pendingLoads.delete(id)
      }
    }
  })
  pendingLoads.set(id, {
    document,
    promise,
    externalEventGeneration: options?.externalEventGeneration
  })
  return promise
}
