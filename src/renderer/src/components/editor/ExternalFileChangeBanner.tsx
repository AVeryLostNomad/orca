import React, { useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { getConnectionIdForFile } from '@/lib/connection-context'
import { readRuntimeFileContent } from '@/runtime/runtime-file-client'
import { settingsForRuntimeOwner } from '@/runtime/runtime-rpc-client'
import { useAppStore } from '@/store'
import type { WorkingDocument } from '@/store/slices/editor/working-document'
import { translate } from '@/i18n/i18n'
import { ExternalFileChangeCompareDialog } from './ExternalFileChangeCompareDialog'
import { getDiskBaselineSignature } from './diff-content-signature'
import { trackExternalChangeConflictAction } from './editor-external-change-telemetry'

const RELOAD_UNDO_TOAST_DURATION_MS = 8_000

export async function reloadWorkingDocumentContentFromDisk(
  document: WorkingDocument
): Promise<void> {
  const expectedRevision = document.revision
  const { target } = document
  const result = await readRuntimeFileContent({
    settings: settingsForRuntimeOwner(
      useAppStore.getState().settings,
      target.owner.runtimeEnvironmentId
    ),
    filePath: target.filePath,
    relativePath: target.relativePath,
    worktreeId: target.worktreeId,
    connectionId: getConnectionIdForFile(target.worktreeId, target.filePath) ?? undefined,
    expectedExternalSshTargetId: target.externalSshTargetId
  })
  if (result.isBinary) {
    throw new Error('The file on disk is binary and cannot replace this text document.')
  }
  const state = useAppStore.getState()
  const current = state.workingDocuments[document.id]
  if (!current || current.revision !== expectedRevision) {
    return
  }
  const discardedContent = current.content
  const discardedDiskSignature = current.lastKnownDiskSignature
  state.discardWorkingDocumentEdits(
    document.id,
    result.content,
    getDiskBaselineSignature(result.content)
  )
  if (discardedContent === undefined) {
    return
  }
  toast(
    translate('auto.components.editor.ExternalFileChangeBanner.5c02de9b31', 'Reloaded from disk'),
    {
      description: target.relativePath,
      duration: RELOAD_UNDO_TOAST_DURATION_MS,
      action: {
        label: translate('auto.components.editor.ExternalFileChangeBanner.d1e830fa22', 'Undo'),
        onClick: () => {
          const latest = useAppStore.getState()
          const liveDocument = latest.workingDocuments[document.id]
          if (!liveDocument || liveDocument.isDirty) {
            return
          }
          latest.setWorkingDocumentContent(document.id, discardedContent)
          latest.setWorkingDocumentExternalState(document.id, { externalMutation: 'changed' })
          if (discardedDiskSignature !== undefined) {
            latest.setWorkingDocumentDiskBaseline(document.id, discardedDiskSignature)
          }
          trackExternalChangeConflictAction(document, 'undo_reload')
        }
      }
    }
  )
}

export function keepWorkingDocumentEditsOverExternalChange(document: WorkingDocument): void {
  const state = useAppStore.getState()
  state.setWorkingDocumentExternalState(document.id, { externalMutation: undefined })
  const { target } = document
  void readRuntimeFileContent({
    settings: settingsForRuntimeOwner(state.settings, target.owner.runtimeEnvironmentId),
    filePath: target.filePath,
    relativePath: target.relativePath,
    worktreeId: target.worktreeId,
    connectionId: getConnectionIdForFile(target.worktreeId, target.filePath) ?? undefined,
    expectedExternalSshTargetId: target.externalSshTargetId
  })
    .then((result) => {
      if (result.isBinary) {
        return
      }
      const current = useAppStore.getState().workingDocuments[document.id]
      if (!current || current.externalMutation === 'changed') {
        return
      }
      useAppStore
        .getState()
        .setWorkingDocumentDiskBaseline(document.id, getDiskBaselineSignature(result.content))
    })
    .catch(() => undefined)
}

export function ExternalFileChangeBanner({
  document,
  currentContent
}: {
  document: WorkingDocument
  currentContent: string
}): React.JSX.Element {
  const [compareOpen, setCompareOpen] = useState(false)
  const handleReload = (): void => {
    trackExternalChangeConflictAction(document, 'reload')
    void reloadWorkingDocumentContentFromDisk(document).catch(() => {
      toast.error(
        translate(
          'auto.components.editor.ExternalFileChangeBanner.reload.failure.2be718a83f',
          'Could not reload the file from disk. Your edits were kept.'
        )
      )
    })
  }
  const handleKeepEdits = (): void => {
    trackExternalChangeConflictAction(document, 'keep')
    keepWorkingDocumentEditsOverExternalChange(document)
  }

  return (
    <div role="alert" className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-xs">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <TriangleAlert className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="min-w-0 font-medium text-foreground">
            {translate(
              'auto.components.editor.ExternalFileChangeBanner.7c41e90d12',
              'This file changed on disk while you have unsaved edits. Saving will overwrite the newer disk content.'
            )}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => {
              trackExternalChangeConflictAction(document, 'compare')
              setCompareOpen(true)
            }}
          >
            {translate('auto.components.editor.ExternalFileChangeBanner.90b2ce7d43', 'Compare')}
          </Button>
          <Button type="button" size="xs" variant="outline" onClick={handleReload}>
            {translate(
              'auto.components.editor.ExternalFileChangeBanner.3fa2b8d417',
              'Reload from Disk'
            )}
          </Button>
          <Button type="button" size="xs" variant="ghost" onClick={handleKeepEdits}>
            {translate(
              'auto.components.editor.ExternalFileChangeBanner.a95d02c644',
              'Keep My Edits'
            )}
          </Button>
        </div>
      </div>
      {compareOpen && (
        <ExternalFileChangeCompareDialog
          document={document}
          currentContent={currentContent}
          open={compareOpen}
          onOpenChange={setCompareOpen}
          onReload={handleReload}
          onKeepEdits={handleKeepEdits}
        />
      )}
    </div>
  )
}
