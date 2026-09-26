import { useCallback, useRef } from 'react'
import type React from 'react'
import { useAppStore } from '@/store'
import { detectLanguage } from '@/lib/language-detect'
import { joinPath } from '@/lib/path'
import { openFilePreviewToSide } from '@/lib/file-preview'
import type { OpenFile } from '@/store/slices/editor'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'
import type { GitBranchChangeEntry } from '../../../../../../shared/git-diff-compare-types'
import { canOpenDiffSectionPreviewToSide } from '../../diff-section-preview'
import type { DiffSection } from '../../diff-section-types'
import { requestEditorDocumentSave } from '../../editor-autosave'

export type CombinedDiffSectionActions = {
  handleSectionSaveRef: React.MutableRefObject<(index: number) => Promise<void>>
  openSection: (index: number) => void
  openSectionPreview: (section: DiffSection) => void
  saveDirtyDocuments: () => Promise<void>
}

export function useCombinedDiffSectionActions({
  activeGroupId,
  branchCompare,
  canOpenWorkspaceFileBrowserForPath,
  commitCompare,
  file,
  isAllMode,
  isBranchMode,
  isCommitMode,
  sectionsRef,
  tabId,
  workingDocumentIdsBySectionKey
}: {
  activeGroupId: string | undefined
  branchCompare: NonNullable<OpenFile['branchCompare']> | null
  canOpenWorkspaceFileBrowserForPath: (path: string) => boolean
  commitCompare: NonNullable<OpenFile['commitCompare']> | null
  file: OpenFile
  isAllMode: boolean
  isBranchMode: boolean
  isCommitMode: boolean
  sectionsRef: React.RefObject<DiffSection[]>
  tabId: string
  workingDocumentIdsBySectionKey: Readonly<Record<string, WorkingDocumentId>>
}): CombinedDiffSectionActions {
  const openFile = useAppStore((s) => s.openFile)
  const openBranchDiff = useAppStore((s) => s.openBranchDiff)
  const openCommitDiff = useAppStore((s) => s.openCommitDiff)

  const openSection = useCallback(
    (index: number) => {
      const section = sectionsRef.current[index]
      if (!section) {
        return
      }

      const language = detectLanguage(section.path)
      const entry: GitBranchChangeEntry = {
        path: section.path,
        status: section.status as GitBranchChangeEntry['status'],
        oldPath: section.oldPath,
        added: section.added,
        removed: section.removed
      }

      const isBranchEntry = section.area === undefined

      if ((isBranchMode || (isAllMode && isBranchEntry)) && branchCompare) {
        openBranchDiff(file.worktreeId, file.filePath, entry, branchCompare, language)
        return
      }

      if (isCommitMode && commitCompare) {
        openCommitDiff(file.worktreeId, file.filePath, entry, commitCompare, language)
        return
      }

      openFile({
        filePath: joinPath(file.filePath, section.path),
        relativePath: section.path,
        worktreeId: file.worktreeId,
        runtimeEnvironmentId: file.runtimeEnvironmentId,
        language,
        mode: 'edit'
      })
    },
    [
      branchCompare,
      commitCompare,
      file.filePath,
      file.runtimeEnvironmentId,
      file.worktreeId,
      isAllMode,
      isBranchMode,
      isCommitMode,
      openBranchDiff,
      openCommitDiff,
      openFile,
      sectionsRef
    ]
  )

  // Why: match single-file HTML diffs — preview the on-disk working tree file
  // beside the combined view when the section is still present on disk.
  const openSectionPreview = useCallback(
    (section: DiffSection) => {
      if (
        !canOpenDiffSectionPreviewToSide({
          path: section.path,
          status: section.status,
          isCommitSurface: isCommitMode,
          canOpenWorkspaceFileBrowser: canOpenWorkspaceFileBrowserForPath(
            joinPath(file.filePath, section.path)
          )
        })
      ) {
        return
      }
      // Why: use this combined-diff tab's group, not worktree activeGroupId —
      // in a multi-pane layout the active group may be a different split.
      const state = useAppStore.getState()
      const sourceGroupId =
        (state.unifiedTabsByWorktree[file.worktreeId] ?? []).find(
          (tab) =>
            tab.entityId === file.id && (tab.contentType === 'diff' || tab.contentType === 'editor')
        )?.groupId ??
        activeGroupId ??
        null
      openFilePreviewToSide({
        language: detectLanguage(section.path),
        filePath: joinPath(file.filePath, section.path),
        worktreeId: file.worktreeId,
        sourceGroupId
      })
    },
    [
      activeGroupId,
      canOpenWorkspaceFileBrowserForPath,
      file.filePath,
      file.id,
      file.worktreeId,
      isCommitMode
    ]
  )

  const handleSectionSave = useCallback(
    async (index: number) => {
      const section = sectionsRef.current[index]
      const documentId = section ? workingDocumentIdsBySectionKey[section.key] : undefined
      if (documentId) {
        await requestEditorDocumentSave({ documentId })
      }
    },
    [sectionsRef, workingDocumentIdsBySectionKey]
  )

  const saveDirtyDocuments = useCallback(async () => {
    const state = useAppStore.getState()
    const documentIds = state.workingDocumentIdsByTab[tabId] ?? []
    await Promise.all(
      [...new Set(documentIds)]
        .filter((documentId) => state.workingDocuments[documentId]?.isDirty)
        .map((documentId) => requestEditorDocumentSave({ documentId }))
    )
  }, [tabId])

  const handleSectionSaveRef = useRef(handleSectionSave)
  handleSectionSaveRef.current = handleSectionSave

  return {
    handleSectionSaveRef,
    openSection,
    openSectionPreview,
    saveDirtyDocuments
  }
}
