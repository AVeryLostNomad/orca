import { useAppStore } from '@/store'
import type { WorkingDocument, WorkingDocumentId } from '@/store/slices/editor/working-document'
import { getEditorFileOperationContext } from '@/lib/editor-file-operation-owner'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { readRuntimeFileContent } from '@/runtime/runtime-file-client'
import { getDiskBaselineSignature } from './diff-content-signature'
import type { FileContent } from './editor-panel-content-types'

const pendingLoads = new Map<
  WorkingDocumentId,
  { document: WorkingDocument; promise: Promise<FileContent> }
>()

export function loadWorkingDocument(
  id: WorkingDocumentId,
  options?: { force?: boolean }
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
  const { target, revision } = document
  const promise: Promise<FileContent> = Promise.resolve().then(async (): Promise<FileContent> => {
    try {
      const worktree = findWorktreeById(state.worktreesByRepo, target.worktreeId)
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
        settings: context.settings,
        filePath: target.filePath,
        relativePath: target.relativePath,
        worktreeId: target.worktreeId,
        connectionId: context.connectionId,
        expectedExternalSshTargetId: target.externalSshTargetId
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
  pendingLoads.set(id, { document, promise })
  return promise
}
