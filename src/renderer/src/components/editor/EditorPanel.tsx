import React, { useCallback, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { getConnectionId } from '@/lib/connection-context'
import { detectLanguage } from '@/lib/language-detect'
import { canShowWorkspaceFileBrowserAction, openFilePreviewToSide } from '@/lib/file-preview'
import { useEditorPanelCopyPathToast } from './useEditorPanelCopyPathToast'
import { getRuntimeTargetForFileOwner } from '@/lib/file-owner-runtime-target'
import { exportActiveMarkdownToPdf } from './export-active-markdown'
import type { EditorToggleValue } from './EditorViewToggle'
import { EditorPanelShell } from './EditorPanelShell'
import { DiffNavigationProvider } from './diff-navigation-context'
import { EditorCommandOwnerContext } from './editor-command-owner-context'
import { canUseChangesModeForFile } from './editor-panel-file-mode'
import { getEditorPanelRenderModel } from './editor-panel-render-model'
import { useEditorCmdSaveRequest } from './useEditorCmdSaveRequest'
import { useEditorPanelContentState } from './useEditorPanelContentState'
import { useMarkdownPreviewShortcut } from './useMarkdownPreviewShortcut'
import { useUntitledFileRename } from './useUntitledFileRename'
import { useScratchLanguageAutodetect } from './useScratchLanguageAutodetect'
import { extractFrontMatter } from './markdown-frontmatter'
import { useEditorContentChangeHandler } from './use-editor-content-change-handler'
import {
  selectEditorPanelGitBranchEntries,
  selectEditorPanelGitStatusEntries
} from './editor-panel-git-entry-selector'
import { createEditorPanelDocumentSelector } from './editor-panel-document-selector'
import {
  createCurrentEditorArtifactRequest,
  createEditorArtifactRequest,
  editorArtifactContentType
} from './editor-artifact-upload'
import { useEditorPanelSave } from './useEditorPanelSave'
import { getWorkingDocumentForFile } from '@renderer/store/slices/editor/working-document-state'
import { isMarkdownReviewNotesEnabled } from '@/lib/markdown-review-notes-setting'

function EditorPanelInner({
  activeFileId: activeFileIdProp,
  activeViewStateId: activeViewStateIdProp,
  isVisible = true,
  isCmdSaveOwner = isVisible,
  markdownAnnotationsEnabled = true
}: {
  activeFileId?: string | null
  activeViewStateId?: string | null
  isVisible?: boolean
  isCmdSaveOwner?: boolean
  markdownAnnotationsEnabled?: boolean
} = {}): React.JSX.Element | null {
  const openFiles = useAppStore((s) => s.openFiles)
  const globalActiveFileId = useAppStore((s) => s.activeFileId)
  const activeFileId = activeFileIdProp ?? globalActiveFileId
  const activeViewStateId = activeViewStateIdProp ?? activeFileId
  const activeFile = openFiles.find((f) => f.id === activeFileId) ?? null
  const activeWorktreeId = activeFile?.worktreeId
  const canOpenWorkspaceFileBrowser = useAppStore((s) =>
    activeWorktreeId && activeFile
      ? canShowWorkspaceFileBrowserAction(s, activeWorktreeId, activeFile.filePath)
      : false
  )
  const activeDocumentId = useAppStore((state) =>
    activeFile ? (getWorkingDocumentForFile(state, activeFile.id)?.id ?? null) : null
  )
  const pendingEditorReveal = useAppStore((s) => s.pendingEditorReveal)
  // Git refreshes for other worktrees must not wake every mounted editor pane.
  const gitStatusEntries = useAppStore((s) =>
    selectEditorPanelGitStatusEntries(s, activeWorktreeId)
  )
  const gitBranchEntries = useAppStore((s) =>
    selectEditorPanelGitBranchEntries(s, activeWorktreeId)
  )
  const markdownViewMode = useAppStore((s) => s.markdownViewMode)
  const setMarkdownViewMode = useAppStore((s) => s.setMarkdownViewMode)
  const markdownRichModeSizeOverridden = useAppStore(
    (s) => activeFileId !== null && s.markdownRichModeSizeOverride[activeFileId] === true
  )
  const editorViewMode = useAppStore((s) => s.editorViewMode)
  const setEditorViewMode = useAppStore((s) => s.setEditorViewMode)
  const openFile = useAppStore((s) => s.openFile)
  const openMarkdownPreview = useAppStore((s) => s.openMarkdownPreview)
  const markdownFrontmatterVisible = useAppStore((s) => s.markdownFrontmatterVisible)
  const setMarkdownFrontmatterVisible = useAppStore((s) => s.setMarkdownFrontmatterVisible)
  const markdownTableOfContentsVisible = useAppStore((s) => s.markdownTableOfContentsVisible)
  const setMarkdownTableOfContentsVisible = useAppStore((s) => s.setMarkdownTableOfContentsVisible)
  const clearUntitled = useAppStore((s) => s.clearUntitled)
  const documentSelector = useMemo(
    () => createEditorPanelDocumentSelector(activeFile),
    [activeFile]
  )
  const documentContentByTab = useAppStore(documentSelector)
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const markdownReviewNotesEnabled = isMarkdownReviewNotesEnabled(settings)
  const panelRef = useRef<HTMLDivElement>(null)
  const { copiedPathToast, registerPanelNode, handleCopyPath } =
    useEditorPanelCopyPathToast(activeFile)
  const setPanelRef = useCallback(
    (node: HTMLDivElement | null) => {
      panelRef.current = node
      registerPanelNode(node)
    },
    [registerPanelNode]
  )
  const [sideBySide, setSideBySide] = useState(settings?.diffDefaultView === 'side-by-side')
  const [prevDiffView, setPrevDiffView] = useState(settings?.diffDefaultView)

  if (settings?.diffDefaultView !== prevDiffView) {
    setPrevDiffView(settings?.diffDefaultView)
    if (settings?.diffDefaultView !== undefined) {
      setSideBySide(settings.diffDefaultView === 'side-by-side')
    }
  }

  const requestedChangesMode =
    !!activeFile &&
    activeFile.mode === 'edit' &&
    canUseChangesModeForFile(activeFile) &&
    editorViewMode[activeFile.id] === 'changes'
  const { fileContents, diffContents, reloadContent } = useEditorPanelContentState({
    activeFile,
    isChangesMode: requestedChangesMode,
    openFiles,
    gitStatusEntries,
    editorViewMode,
    isVisible
  })
  const isChangesMode =
    requestedChangesMode &&
    !!activeFile &&
    !fileContents[activeFile.id]?.isBinary &&
    !fileContents[activeFile.id]?.loadError
  const {
    renameDialogFile,
    renameError,
    requestRenameForFile,
    closeRenameDialog,
    handleRenameConfirm
  } = useUntitledFileRename({ openFiles, clearUntitled })
  // Unresolved owners must not fall back to this machine’s folder picker.
  const renameDialogFileOffClient = useAppStore(
    (s) =>
      !!renameDialogFile &&
      getRuntimeTargetForFileOwner(
        s,
        renameDialogFile.worktreeId,
        renameDialogFile.runtimeEnvironmentId
      )?.kind !== 'local'
  )

  useScratchLanguageAutodetect(activeFile)
  useMarkdownPreviewShortcut({ activeFile, panelRef, openMarkdownPreview })

  const handleDocumentContentChange = useEditorContentChangeHandler()
  const handleContentChangeForFile = useCallback(
    (file: (typeof openFiles)[number], content: string) => {
      const id = getWorkingDocumentForFile(useAppStore.getState(), file.id)?.id ?? null
      handleDocumentContentChange(id, content)
    },
    [handleDocumentContentChange]
  )

  const handleContentChange = useCallback(
    (content: string) => {
      handleDocumentContentChange(activeDocumentId, content)
    },
    [activeDocumentId, handleDocumentContentChange]
  )

  const { handleSave, handleSaveForDocument } = useEditorPanelSave({
    activeDocumentId,
    activeFile,
    requestRenameForFile
  })
  useEditorCmdSaveRequest({
    ownerTabId: activeViewStateId ?? null,
    activeDocumentId,
    isUntitled: activeFile?.isUntitled === true,
    handleSave,
    enabled: isCmdSaveOwner
  })

  const activeDiffContent = activeFile ? diffContents[activeFile.id] : undefined
  const handleCopyDiffModifiedContents = useCallback(async (): Promise<void> => {
    if (!activeFile) {
      return
    }
    const dc = diffContents[activeFile.id]
    if (dc?.kind !== 'text') {
      return
    }
    // Why: an in-progress diff edit is what the user sees, so copy the draft over the snapshot.
    await window.api.ui.writeClipboardText(
      documentContentByTab[activeFile.id] ?? dc.modifiedContent
    )
  }, [activeFile, diffContents, documentContentByTab])

  if (!activeFile) {
    return null
  }
  const model = getEditorPanelRenderModel({
    activeFile,
    fileContents,
    documentContentByTab,
    gitStatusEntries,
    gitBranchEntries,
    markdownViewMode,
    markdownRichModeSizeOverridden,
    isChangesMode,
    canOpenWorkspaceFileBrowser
  })

  const handleOpenPreviewToSide = (): void => {
    const state = useAppStore.getState()
    const sourceGroupId = activeViewStateId
      ? ((state.unifiedTabsByWorktree[activeFile.worktreeId] ?? []).find(
          (t) => t.id === activeViewStateId
        )?.groupId ?? null)
      : null
    openFilePreviewToSide({
      language: model.resolvedLanguage,
      filePath: activeFile.filePath,
      worktreeId: activeFile.worktreeId,
      sourceGroupId
    })
  }
  const handleOpenDiffTargetFile = (preferredMarkdownViewMode?: 'rich'): void => {
    if (!model.openFileState.canOpen) {
      return
    }
    openFile({
      filePath: activeFile.filePath,
      relativePath: activeFile.relativePath,
      worktreeId: activeFile.worktreeId,
      runtimeEnvironmentId: activeFile.runtimeEnvironmentId,
      language: detectLanguage(activeFile.relativePath),
      mode: 'edit'
    })
    if (preferredMarkdownViewMode) {
      setEditorViewMode(activeFile.filePath, 'edit')
      setMarkdownViewMode(activeFile.filePath, preferredMarkdownViewMode)
    }
  }
  const handleEditorToggleChange = (next: EditorToggleValue): void => {
    const fileId = activeFile.id
    if (activeFile.mode === 'diff' && model.isMarkdown && next === 'rich') {
      handleOpenDiffTargetFile('rich')
      return
    }
    if (next === 'changes') {
      setEditorViewMode(fileId, 'changes')
      return
    }
    setEditorViewMode(fileId, 'edit')
    if (next !== 'edit') {
      setMarkdownViewMode(fileId, next)
    }
  }
  const handleOpenMarkdownPreview = (): void => {
    openMarkdownPreview(
      {
        filePath: activeFile.filePath,
        relativePath: activeFile.relativePath,
        worktreeId: activeFile.worktreeId,
        runtimeEnvironmentId: activeFile.runtimeEnvironmentId,
        language: model.resolvedLanguage
      },
      { sourceFileId: activeFile.id }
    )
  }
  const disableRenameBrowse = Boolean(
    renameDialogFileOffClient ||
    (renameDialogFile ? getConnectionId(renameDialogFile.worktreeId) : null)
  )
  const markdownDocumentStateFileId =
    activeFile.mode === 'markdown-preview'
      ? (activeFile.markdownPreviewSourceFileId ?? activeFile.filePath)
      : activeFile.id
  let activeDocumentContent: string | null = null
  if (activeFile.mode === 'markdown-preview') {
    activeDocumentContent =
      documentContentByTab[markdownDocumentStateFileId] ??
      fileContents[activeFile.id]?.content ??
      null
  } else if (activeFile.mode === 'edit') {
    activeDocumentContent =
      documentContentByTab[activeFile.id] ?? fileContents[activeFile.id]?.content ?? null
  }
  const canShowMarkdownFrontmatterToggle = Boolean(
    model.isMarkdown &&
    (activeFile.mode === 'markdown-preview' || model.mdViewMode !== 'source') &&
    activeDocumentContent &&
    extractFrontMatter(activeDocumentContent)
  )
  // The map stores only per-file hide overrides; frontmatter is visible by default.
  const isMarkdownFrontmatterVisible =
    markdownFrontmatterVisible[markdownDocumentStateFileId] ?? true
  const isMarkdownTableOfContentsVisible =
    markdownTableOfContentsVisible[markdownDocumentStateFileId] ?? false
  const artifactContentType = editorArtifactContentType(activeFile.filePath, model.isMarkdown)
  const createActiveArtifactRequest =
    activeDocumentContent === null || artifactContentType === null
      ? undefined
      : () => {
          // Previews share their source tab's working document.
          const documentId =
            getWorkingDocumentForFile(useAppStore.getState(), markdownDocumentStateFileId)?.id ??
            activeDocumentId
          return Promise.resolve(
            documentId
              ? createCurrentEditorArtifactRequest(
                  activeFile,
                  documentId,
                  activeDocumentContent ?? '',
                  artifactContentType
                )
              : createEditorArtifactRequest(
                  activeFile,
                  activeDocumentContent ?? '',
                  artifactContentType
                )
          )
        }

  return (
    <EditorCommandOwnerContext value={isCmdSaveOwner}>
      {/* Split panes need independent bridges between diff editors and header controls. */}
      <DiffNavigationProvider>
        <EditorPanelShell
          panelRef={setPanelRef}
          activeFile={activeFile}
          activeViewStateId={activeViewStateId}
          model={model}
          copiedPathVisible={copiedPathToast?.fileId === activeFile.id}
          showMarkdownTableOfContents={isMarkdownTableOfContentsVisible}
          canShowMarkdownFrontmatterToggle={canShowMarkdownFrontmatterToggle}
          markdownFrontmatterVisible={isMarkdownFrontmatterVisible}
          sideBySide={sideBySide}
          openFiles={openFiles}
          fileContents={fileContents}
          diffContents={diffContents}
          documentContentByTab={documentContentByTab}
          pendingEditorReveal={pendingEditorReveal}
          renameDialogFile={renameDialogFile}
          renameError={renameError}
          disableRenameBrowse={disableRenameBrowse}
          onCopyPath={() => void handleCopyPath()}
          onCopyDiffModifiedContents={
            activeDiffContent?.kind === 'text' ? handleCopyDiffModifiedContents : undefined
          }
          onOpenDiffTargetFile={handleOpenDiffTargetFile}
          onOpenPreviewToSide={handleOpenPreviewToSide}
          onOpenMarkdownPreview={handleOpenMarkdownPreview}
          onToggleSideBySide={() => {
            // Persist as a durable preference; the prevDiffView sync folds it back into local state.
            void updateSettings({ diffDefaultView: sideBySide ? 'inline' : 'side-by-side' })
            setSideBySide((prev) => !prev)
          }}
          onEditorToggleChange={handleEditorToggleChange}
          onToggleMarkdownTableOfContents={() =>
            setMarkdownTableOfContentsVisible(
              markdownDocumentStateFileId,
              !isMarkdownTableOfContentsVisible
            )
          }
          onToggleMarkdownFrontmatter={() =>
            setMarkdownFrontmatterVisible(
              markdownDocumentStateFileId,
              !isMarkdownFrontmatterVisible
            )
          }
          onExportMarkdownToPdf={() =>
            void exportActiveMarkdownToPdf({ fileId: activeFile.id, root: panelRef.current })
          }
          createArtifactRequest={createActiveArtifactRequest}
          onContentChange={handleContentChange}
          onContentChangeForFile={handleContentChangeForFile}
          onSave={handleSave}
          onSaveForDocument={handleSaveForDocument}
          onReloadContent={reloadContent}
          onCloseMarkdownTableOfContents={() =>
            setMarkdownTableOfContentsVisible(markdownDocumentStateFileId, false)
          }
          onCloseRenameDialog={closeRenameDialog}
          onRenameConfirm={handleRenameConfirm}
          markdownAnnotationsEnabled={markdownAnnotationsEnabled && markdownReviewNotesEnabled}
        />
      </DiffNavigationProvider>
    </EditorCommandOwnerContext>
  )
}

export default React.memo(EditorPanelInner)
