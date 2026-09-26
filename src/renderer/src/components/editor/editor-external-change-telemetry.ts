import { track } from '@/lib/telemetry'
import { getConnectionIdForFile } from '@/lib/connection-context'
import type { WorkingDocument } from '@/store/slices/editor/working-document'

type ConflictTransport = 'local' | 'ssh' | 'runtime'

export type ExternalChangeConflictAction =
  | 'reload'
  | 'keep'
  | 'compare'
  | 'undo_reload'
  | 'save_overwrite'

function conflictTransport(document: WorkingDocument): ConflictTransport {
  if (getConnectionIdForFile(document.target.worktreeId, document.target.filePath)) {
    return 'ssh'
  }
  return document.target.owner.runtimeEnvironmentId ? 'runtime' : 'local'
}

export function trackExternalChangeConflictShown(
  document: WorkingDocument,
  options: { origin: 'live' | 'restore' }
): void {
  track('editor_external_change_conflict_shown', {
    surface: 'edit',
    transport: conflictTransport(document),
    origin: options.origin
  })
}

export function trackExternalChangeConflictAction(
  document: WorkingDocument,
  action: ExternalChangeConflictAction
): void {
  track('editor_external_change_conflict_action', {
    action,
    surface: 'edit',
    transport: conflictTransport(document)
  })
}
