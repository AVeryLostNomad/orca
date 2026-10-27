import type { AppState } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import type { WorkingDocument } from '@/store/slices/editor/working-document'
import { getWorkingDocumentForFile } from '@/store/slices/editor/working-document-state'
import type {
  FileWriteDiskPrecondition,
  FileWriteResult
} from '../../../../shared/file-write-disk-precondition'
import type { LocalFileAccess } from '../../../../shared/local-file-access'
import type { RuntimeFileOperationArgs } from '@/runtime/runtime-file-client-types'
import { writeRuntimeFile } from '@/runtime/runtime-file-mutation-client'
import { writeRuntimeTerminalArtifactFile } from '@/runtime/runtime-terminal-artifact-write'
import { getRelativePathInsideWorktree } from '@/runtime/runtime-file-routing'
import { chatScratchFileAddress } from '@/runtime/runtime-chat-scratch-file-address'
import { captureRuntimeEnvironmentRequestRevision } from '@/runtime/runtime-environment-revision'
import { grantRestoredHostFile } from './restored-host-file-grant'

type DocumentTab = Pick<
  OpenFile,
  | 'id'
  | 'filePath'
  | 'relativePath'
  | 'worktreeId'
  | 'runtimeEnvironmentId'
  | 'externalSshTargetId'
  | 'terminalArtifactGrantId'
>

/** The open tab that carries the document's file authority (host grant, user-named path). */
export function documentSaveTab(
  state: Pick<
    AppState,
    'openFiles' | 'workingDocuments' | 'workingDocumentIdsByTab' | 'unifiedTabsByWorktree'
  >,
  document: WorkingDocument
): DocumentTab {
  const views = (state.openFiles ?? []).filter(
    (file) => getWorkingDocumentForFile(state, file.id)?.id === document.id
  )
  const tab = views.find((file) => file.terminalArtifactGrantId) ?? views[0]
  if (tab) {
    return tab
  }
  // Why a synthesized view: a document can outlive its tabs while a save settles.
  return {
    id: document.id,
    filePath: document.target.filePath,
    relativePath: document.target.relativePath,
    worktreeId: document.target.worktreeId,
    runtimeEnvironmentId: document.target.owner.runtimeEnvironmentId,
    externalSshTargetId: document.target.externalSshTargetId
  }
}

/** The tab's host grant for a file outside every workspace; a renewed grant is kept on the tab. */
export type DocumentSaveGrant = {
  grantId: string
  onRenewed: (grantId: string) => void
  /** Captured before any await so a same-id re-pair cannot retarget the save. */
  expectedEnvironmentPairingRevision?: number
}

/** Sync unless a restored tab must ask its host, so ordinary saves gain no await before their pairing pin. */
export function documentSaveGrant(
  tab: DocumentTab,
  context: RuntimeFileOperationArgs,
  getState: () => Pick<AppState, 'setTerminalArtifactGrant' | 'openFiles'>
): DocumentSaveGrant | Promise<DocumentSaveGrant> | undefined {
  const onRenewed = (renewed: string): void => {
    if (getState().openFiles.some((file) => file.id === tab.id)) {
      getState().setTerminalArtifactGrant(tab.id, renewed)
    }
  }
  const expectedEnvironmentPairingRevision =
    context.target.kind === 'environment'
      ? captureRuntimeEnvironmentRequestRevision(context.target.environmentId)
      : undefined
  if (tab.terminalArtifactGrantId) {
    return { grantId: tab.terminalArtifactGrantId, onRenewed, expectedEnvironmentPairingRevision }
  }
  // Why: grants are never persisted, so a restored tab that never loaded asks its host before saving.
  if (
    context.target.kind !== 'environment' ||
    tab.relativePath !== tab.filePath ||
    getRelativePathInsideWorktree(context.worktreePath, tab.filePath) !== null ||
    chatScratchFileAddress(tab.filePath)
  ) {
    return undefined
  }
  const target = context.target
  return (async () => {
    const restored = await grantRestoredHostFile(
      target,
      context.worktreeId,
      tab.filePath,
      expectedEnvironmentPairingRevision
    )
    // Why: refuse rather than mark the tab read-only, which would drop its edits.
    if (restored.readOnly) {
      throw new Error('This host opens the file read-only.')
    }
    onRenewed(restored.grantId)
    return { grantId: restored.grantId, onRenewed, expectedEnvironmentPairingRevision }
  })()
}

/** Writes through the host grant when the file lives outside every workspace, else by path. */
export function writeDocumentFile(
  context: RuntimeFileOperationArgs,
  filePath: string,
  content: string,
  access: LocalFileAccess | undefined,
  precondition: FileWriteDiskPrecondition | undefined,
  beforeSend: () => void,
  grant: DocumentSaveGrant | Promise<DocumentSaveGrant> | undefined
): Promise<FileWriteResult> {
  if (!grant) {
    return writeRuntimeFile(context, filePath, content, access, precondition, beforeSend)
  }
  // Why: a granted host file must never fall through to a write of this computer's same path.
  if (context.target.kind !== 'environment' || !context.worktreeId) {
    throw new Error('This file belongs to a host that is no longer this tab’s owner.')
  }
  const target = context.target
  const worktreeId = context.worktreeId
  return Promise.resolve(grant).then((resolved) =>
    writeRuntimeTerminalArtifactFile({
      target,
      worktreeId,
      absolutePath: filePath,
      grantId: resolved.grantId,
      content,
      precondition,
      beforeSend,
      onGrantRenewed: resolved.onRenewed,
      expectedEnvironmentPairingRevision: resolved.expectedEnvironmentPairingRevision
    })
  )
}
