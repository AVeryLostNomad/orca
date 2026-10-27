import { Suspense, type JSX, type Ref } from 'react'
import { useAppStore } from '@/store'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import type { OpenFile } from '@/store/slices/editor'
import { EditorContent } from './EditorContent'
import { EditorPanelHeader } from './EditorPanelHeader'
import { UntitledFileRenameDialog } from './UntitledFileRenameDialog'
import type { getEditorPanelRenderModel } from './editor-panel-render-model'
import type { DiffContent, FileContent } from './editor-panel-content-types'
import type { EditorToggleValue } from './EditorViewToggle'
import { shouldShowEditorPanelHeader } from './editor-header'
import { getUntitledFileRoot } from './untitled-file-rename-path'
import { translate } from '@/i18n/i18n'
import type { ArtifactWriteRequest } from '../../../../shared/artifacts'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'
import { selectWorktreesByRepo } from '@/store/workspace-record-selectors'

type EditorPanelRenderModel = ReturnType<typeof getEditorPanelRenderModel>

type EditorPanelShellProps = {
  panelRef: Ref<HTMLDivElement>
  activeFile: OpenFile
  activeViewStateId: string | null | undefined
  model: EditorPanelRenderModel
  copiedPathVisible: boolean
  showMarkdownTableOfContents: boolean
  canShowMarkdownFrontmatterToggle: boolean
  markdownFrontmatterVisible: boolean
  sideBySide: boolean
  openFiles: OpenFile[]
  fileContents: Record<string, FileContent>
  diffContents: Record<string, DiffContent>
  documentContentByTab: Record<string, string>
  pendingEditorReveal: ReturnType<typeof useAppStore.getState>['pendingEditorReveal']
  renameDialogFile: OpenFile | null
  renameError: string | null
  disableRenameBrowse: boolean
  onCopyPath: () => void
  onCopyDiffModifiedContents?: () => Promise<void>
  onOpenDiffTargetFile: (preferredMarkdownViewMode?: 'rich') => void
  onOpenPreviewToSide: () => void
  onOpenMarkdownPreview: () => void
  onToggleSideBySide: () => void
  onEditorToggleChange: (next: EditorToggleValue) => void
  onToggleMarkdownTableOfContents: () => void
  onToggleMarkdownFrontmatter: () => void
  onExportMarkdownToPdf: () => void
  createArtifactRequest?: () => Promise<ArtifactWriteRequest>
  onContentChange: (content: string) => void
  onContentChangeForFile: (file: OpenFile, content: string) => void
  onSave: () => Promise<boolean>
  onSaveForDocument: (documentId: WorkingDocumentId | null) => Promise<boolean>
  onReloadContent: (file: OpenFile, options?: { wakeWslDistro?: boolean }) => void
  onCloseMarkdownTableOfContents: () => void
  onCloseRenameDialog: () => void
  onRenameConfirm: (newRelPath: string) => Promise<void>
  markdownAnnotationsEnabled: boolean
}

export function EditorPanelShell({
  panelRef,
  activeFile,
  activeViewStateId,
  model,
  copiedPathVisible,
  showMarkdownTableOfContents,
  canShowMarkdownFrontmatterToggle,
  markdownFrontmatterVisible,
  sideBySide,
  openFiles,
  fileContents,
  diffContents,
  documentContentByTab,
  pendingEditorReveal,
  renameDialogFile,
  renameError,
  disableRenameBrowse,
  onCopyPath,
  onCopyDiffModifiedContents,
  onOpenDiffTargetFile,
  onOpenPreviewToSide,
  onOpenMarkdownPreview,
  onToggleSideBySide,
  onEditorToggleChange,
  onToggleMarkdownTableOfContents,
  onToggleMarkdownFrontmatter,
  onExportMarkdownToPdf,
  createArtifactRequest,
  onContentChange,
  onContentChangeForFile,
  onSave,
  onSaveForDocument,
  onReloadContent,
  onCloseMarkdownTableOfContents,
  onCloseRenameDialog,
  onRenameConfirm,
  markdownAnnotationsEnabled
}: EditorPanelShellProps): JSX.Element {
  return (
    <div ref={panelRef} className="flex flex-col flex-1 min-w-0 min-h-0">
      {shouldShowEditorPanelHeader(activeFile, model.isCombinedDiff) && (
        <EditorPanelHeader
          activeFile={activeFile}
          copiedPathVisible={copiedPathVisible}
          isSingleDiff={model.isSingleDiff}
          isDiffSurface={model.isDiffSurface}
          isMarkdown={model.isMarkdown}
          isCsv={model.isCsv}
          isNotebook={model.isNotebook}
          hasEditorToggle={model.hasEditorToggle}
          availableEditorToggleModes={model.availableEditorToggleModes}
          effectiveToggleValue={model.effectiveToggleValue}
          canOpenPreviewToSide={model.canOpenPreviewToSide}
          canShowMarkdownPreview={model.canShowMarkdownPreview}
          canShowMarkdownTableOfContents={model.canShowMarkdownTableOfContents}
          isMarkdownTableOfContentsDisabled={model.isMarkdownTableOfContentsDisabled}
          shouldShowMarkdownExportAction={model.shouldShowMarkdownExportAction}
          canExportMarkdownToPdf={model.canExportMarkdownToPdf}
          showMarkdownTableOfContents={showMarkdownTableOfContents}
          canShowMarkdownFrontmatterToggle={canShowMarkdownFrontmatterToggle}
          markdownFrontmatterVisible={markdownFrontmatterVisible}
          sideBySide={sideBySide}
          openFileState={model.openFileState}
          onCopyPath={onCopyPath}
          onCopyDiffModifiedContents={onCopyDiffModifiedContents}
          onOpenDiffTargetFile={onOpenDiffTargetFile}
          onOpenPreviewToSide={onOpenPreviewToSide}
          onOpenMarkdownPreview={onOpenMarkdownPreview}
          onToggleSideBySide={onToggleSideBySide}
          onEditorToggleChange={onEditorToggleChange}
          onToggleMarkdownTableOfContents={onToggleMarkdownTableOfContents}
          onToggleMarkdownFrontmatter={onToggleMarkdownFrontmatter}
          onExportMarkdownToPdf={onExportMarkdownToPdf}
          createArtifactRequest={createArtifactRequest}
        />
      )}
      <Suspense fallback={<EditorLoadingFallback />}>
        <EditorContent
          activeFile={activeFile}
          viewStateScopeId={activeViewStateId ?? activeFile.id}
          fileContents={fileContents}
          diffContents={diffContents}
          editBuffers={documentContentByTab}
          openFiles={openFiles}
          worktreeEntries={model.worktreeEntries}
          resolvedLanguage={model.resolvedLanguage}
          isMarkdown={model.isMarkdown}
          isMermaid={model.isMermaid}
          isCsv={model.isCsv}
          isNotebook={model.isNotebook}
          mdViewMode={model.mdViewMode}
          inlineMarkdownRenderState={model.inlineMarkdownRenderState}
          isChangesMode={model.isDiffSurface && !model.isSingleDiff}
          sideBySide={sideBySide}
          pendingEditorReveal={pendingEditorReveal}
          handleContentChange={onContentChange}
          handleContentChangeForFile={onContentChangeForFile}
          handleSave={onSave}
          handleSaveForDocument={onSaveForDocument}
          reloadContent={onReloadContent}
          showMarkdownTableOfContents={showMarkdownTableOfContents}
          showMarkdownFrontmatter={markdownFrontmatterVisible}
          onCloseMarkdownTableOfContents={onCloseMarkdownTableOfContents}
          markdownAnnotationsEnabled={markdownAnnotationsEnabled}
        />
      </Suspense>
      <UntitledFileRenameDialog
        open={renameDialogFile !== null}
        currentName={renameDialogFile?.relativePath ?? ''}
        worktreePath={
          renameDialogFile
            ? getUntitledFileRoot(
                renameDialogFile,
                findWorktreeById(
                  selectWorktreesByRepo(useAppStore.getState()),
                  renameDialogFile.worktreeId
                )?.path
              )
            : ''
        }
        disableBrowse={disableRenameBrowse}
        externalError={renameError}
        onClose={onCloseRenameDialog}
        onConfirm={onRenameConfirm}
      />
    </div>
  )
}

function EditorLoadingFallback(): JSX.Element {
  return (
    <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
      {translate('auto.components.editor.EditorPanelShell.e2c4dec350', 'Loading editor...')}
    </div>
  )
}
