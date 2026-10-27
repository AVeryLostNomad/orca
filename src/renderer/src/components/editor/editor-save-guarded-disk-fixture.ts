// Compare preconditions inside the fake host write, matching the real guarded writer.
import { vi } from 'vitest'
import type { StoreApi } from 'zustand'
import type { AppState } from '@/store'
import { getDiskBaselineSignature } from '../../../../shared/disk-baseline-signature'
import {
  buildWorkingDocumentTarget,
  type WorkingDocument,
  type WorkingDocumentId
} from '@/store/slices/editor/working-document'
import { getWorkingDocumentForFile } from '@/store/slices/editor/working-document-state'
import {
  compareDiskWritePrecondition,
  type FileWriteDiskPrecondition
} from '../../../../shared/file-write-disk-precondition'

export const GUARDED_PATH = '/repo/file.ts'

export type GuardedWriteArgs = {
  filePath: string
  content: string
  diskPrecondition?: FileWriteDiskPrecondition
}

export function stubGuardedDisk(
  initial: Record<string, string>,
  beforeWrite: () => Promise<void> = () => Promise.resolve()
) {
  const files = new Map(Object.entries(initial))
  const writeFile = vi.fn(async ({ filePath, content, diskPrecondition }: GuardedWriteArgs) => {
    await beforeWrite()
    if (diskPrecondition) {
      const diskConflict = compareDiskWritePrecondition(
        diskPrecondition,
        files.get(filePath) ?? null,
        content
      )
      if (diskConflict === 'identical') {
        return { ok: true, unchanged: true }
      }
      if (diskConflict) {
        return { ok: false, diskConflict }
      }
    }
    files.set(filePath, content)
    return { ok: true }
  })
  const eventTarget = new EventTarget()
  vi.stubGlobal('window', {
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
    dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    api: { fs: { writeFile } }
  })
  return { files, writeFile }
}

export function openGuardedFile(
  store: StoreApi<AppState>,
  options: { baseline?: string; draft: string; filePath?: string; language?: string }
): string {
  const filePath = options.filePath ?? GUARDED_PATH
  store.getState().openFile({
    filePath,
    relativePath: filePath.slice('/repo/'.length),
    worktreeId: 'wt-1',
    language: options.language ?? 'typescript',
    mode: 'edit'
  })
  const fileId = store.getState().openFiles.find((file) => file.filePath === filePath)!.id
  // Loading the tab retains its working document with the loaded disk text as baseline.
  const documentId = retainGuardedDocument(store, fileId)
  const loaded = options.baseline ?? ''
  const revision = store.getState().workingDocuments[documentId]!.revision
  store
    .getState()
    .acceptWorkingDocumentLoad(documentId, revision, loaded, getDiskBaselineSignature(loaded))
  if (options.baseline === undefined) {
    store.getState().setWorkingDocumentDiskBaseline(documentId, undefined)
  }
  store.getState().setWorkingDocumentContent(documentId, options.draft)
  return fileId
}

/** Retains the tab's owner/path working document, as the content loader does on first load. */
export function retainGuardedDocument(
  store: StoreApi<AppState>,
  fileId: string
): WorkingDocumentId {
  const state = store.getState()
  const file = state.openFiles.find((openFile) => openFile.id === fileId)!
  return state.retainWorkingDocument(fileId, buildWorkingDocumentTarget(state, file))
}

export function guardedDocument(store: StoreApi<AppState>, fileId: string): WorkingDocument {
  return getWorkingDocumentForFile(store.getState(), fileId)!
}
