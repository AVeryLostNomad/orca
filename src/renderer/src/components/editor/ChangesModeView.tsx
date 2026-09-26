import React from 'react'
import type { OpenFile } from '@/store/slices/editor'
import type { GitDiffResult } from '../../../../shared/git-diff-compare-types'
import type { GitStatusEntry } from '../../../../shared/git-status-types'
import { ConflictBanner } from './ConflictComponents'
import { PierreFileDiff } from './editor-lazy-views'
import { translate } from '@/i18n/i18n'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'

// Why: Changes view mode renders an edit-mode tab as a HEAD-vs-working-tree
// diff without creating a separate diff-tab object. The modified side is the
// canonical working-document model, so dirty tracking and autosave stay shared.
export function ChangesModeView({
  activeFile,
  workingDocumentId,
  dc,
  modifiedContent,
  activeConflictEntry,
  resolvedLanguage,
  sideBySide,
  viewStateScopeId,
  diffViewStateKey,
  onSave
}: {
  activeFile: OpenFile
  workingDocumentId?: WorkingDocumentId
  dc: GitDiffResult | undefined
  modifiedContent: string
  activeConflictEntry: GitStatusEntry | null
  resolvedLanguage: string
  sideBySide: boolean
  viewStateScopeId: string
  diffViewStateKey: string
  onSave: (content: string) => Promise<boolean>
}): React.JSX.Element {
  if (!dc) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        {translate('auto.components.editor.ChangesModeView.54e0035b15', 'Loading diff...')}
      </div>
    )
  }
  if (dc.kind === 'binary') {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <div className="space-y-2">
          <div className="text-sm font-medium text-foreground">
            {translate('auto.components.editor.ChangesModeView.7dffb0f563', 'Binary file')}
          </div>
          <div className="text-xs text-muted-foreground">
            {translate(
              'auto.components.editor.ChangesModeView.052c184f24',
              'Text diff is unavailable for this file.'
            )}
          </div>
        </div>
      </div>
    )
  }
  const isDiffBodyPruned = dc.largeDiffRenderLimit?.limited === true
  const isIdentical = !isDiffBodyPruned && dc.originalContent === modifiedContent
  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {activeFile.conflict && <ConflictBanner file={activeFile} entry={activeConflictEntry} />}
      {isIdentical && (
        <div className="border-b border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {translate(
            'auto.components.editor.ChangesModeView.ef25ae2d09',
            'No uncommitted changes.'
          )}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        <PierreFileDiff
          key={viewStateScopeId}
          scrollKey={diffViewStateKey}
          originalContent={dc.originalContent}
          modifiedContent={modifiedContent}
          originalReadState={dc.originalReadState}
          modifiedReadState={dc.modifiedReadState}
          largeDiffRenderLimit={dc.largeDiffRenderLimit}
          language={resolvedLanguage}
          relativePath={activeFile.relativePath}
          sideBySide={sideBySide}
          worktreeId={activeFile.worktreeId}
          workingDocumentId={workingDocumentId}
          onSave={workingDocumentId ? onSave : undefined}
        />
      </div>
    </div>
  )
}
