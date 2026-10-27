import { useEffect, useRef, type MutableRefObject } from 'react'
import type { OpenFile } from '@/store/slices/editor'
import { joinPath } from '@/lib/path'
import { useAppStore } from '@/store'
import type { DiffContent, FileContent } from './editor-panel-content-types'
import { isReloadableSingleFileDiffTab } from './editor-panel-diff-reload'
import type { EditorPanelDiffContentLoader } from './useEditorPanelDiffContentLoader'
import type { EditorPanelFileContentLoader } from './useEditorPanelFileContentLoader'
import { getEditorGitBaselineScope } from './editor-panel-file-mode'
import { useQuickOpenHistoryVisit } from './use-quick-open-history-visit'

// Showing a tab is a user act: its first load may start a stopped WSL distro. Re-runs from
// polls (git status, overview views) are not, so they read without waking.
const ACTIVE_TAB_LOAD = { wakeWslDistro: true }

type GitStatusByWorktree = ReturnType<typeof useAppStore.getState>['gitStatusByWorktree']

type UseEditorPanelActiveTabContentLoadParams = {
  activeFile: OpenFile | null
  selectedConflictReviewFile: OpenFile | null
  isVisible: boolean
  isChangesMode: boolean
  gitStatusEntries: GitStatusByWorktree[string] | undefined
  fileContents: Record<string, FileContent>
  diffContents: Record<string, DiffContent>
  fileReadGenerationRef: MutableRefObject<Record<string, number>>
  outstandingFileReadsRef: MutableRefObject<Record<string, number>>
  diffReadGenerationRef: MutableRefObject<Record<string, number>>
  outstandingDiffReadsRef: MutableRefObject<Record<string, number>>
  loadFileContent: EditorPanelFileContentLoader
  loadDiffContent: EditorPanelDiffContentLoader
}

// Reuse live reads across visibility changes; invalidation generations distinguish superseded reads.
function hasLiveRead(
  generationsById: Record<string, number>,
  outstandingById: Record<string, number>,
  id: string
): boolean {
  const generation = generationsById[id]
  return generation !== undefined && outstandingById[id] === generation
}

export function useEditorPanelActiveTabContentLoad({
  activeFile,
  selectedConflictReviewFile,
  isVisible,
  isChangesMode,
  gitStatusEntries,
  fileContents,
  diffContents,
  fileReadGenerationRef,
  outstandingFileReadsRef,
  diffReadGenerationRef,
  outstandingDiffReadsRef,
  loadFileContent,
  loadDiffContent
}: UseEditorPanelActiveTabContentLoadParams): void {
  useQuickOpenHistoryVisit(
    activeFile,
    activeFile ? fileContents[activeFile.id] : undefined,
    isVisible
  )
  const baselineScope = useAppStore((state) =>
    activeFile ? getEditorGitBaselineScope(state, activeFile) : null
  )
  const baselineFileReady = activeFile
    ? fileContents[activeFile.id]?.isBinary === false && !fileContents[activeFile.id]?.loadError
    : false
  const activeDiff = activeFile ? diffContents[activeFile.id] : undefined
  const needsWorkingDiffDocument =
    activeFile?.mode === 'diff' &&
    activeFile.diffSource === 'unstaged' &&
    !activeFile.readOnly &&
    activeDiff?.kind === 'text' &&
    !activeDiff.largeDiffRenderLimit?.limited &&
    activeDiff.modifiedReadState !== 'absent'
  const needsFileRead = (fileId: string): boolean => {
    const cached = fileContents[fileId]
    return (
      (!cached || cached.isStale === true) &&
      !hasLiveRead(fileReadGenerationRef.current, outstandingFileReadsRef.current, fileId)
    )
  }
  const shouldForceFileRead = (fileId: string): boolean =>
    fileContents[fileId]?.isStale === true ||
    (fileReadGenerationRef.current[fileId] ?? 0) > 1 ||
    (outstandingFileReadsRef.current[fileId] !== undefined &&
      outstandingFileReadsRef.current[fileId] !== fileReadGenerationRef.current[fileId])
  const needsDiffRead = (fileId: string): boolean => {
    const cached = diffContents[fileId]
    return (
      (!cached || cached.isStale === true) &&
      !hasLiveRead(diffReadGenerationRef.current, outstandingDiffReadsRef.current, fileId)
    )
  }

  const wokenTabIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!isVisible) {
      return
    }
    const tabId = selectedConflictReviewFile?.id ?? activeFile?.id ?? null
    const load = tabId !== wokenTabIdRef.current ? ACTIVE_TAB_LOAD : undefined
    wokenTabIdRef.current = tabId
    if (activeFile?.mode === 'conflict-review' && !selectedConflictReviewFile) {
      const snapshotEntries = activeFile.conflictReview?.entries ?? []
      if (snapshotEntries.length === 0) {
        return
      }

      const snapshotPaths = new Set(snapshotEntries.map((entry) => entry.path))
      const liveEntries = gitStatusEntries ?? []
      for (const entry of liveEntries) {
        if (
          !snapshotPaths.has(entry.path) ||
          entry.conflictStatus !== 'unresolved' ||
          !entry.conflictKind ||
          entry.status === 'deleted'
        ) {
          continue
        }

        const absolutePath = joinPath(activeFile.filePath, entry.path)
        if (needsFileRead(absolutePath)) {
          void loadFileContent(absolutePath, absolutePath, activeFile.worktreeId, entry.path, load)
        }
      }
      return
    }

    const fileToLoad = selectedConflictReviewFile ?? activeFile
    if (!fileToLoad || (activeFile?.mode === 'conflict-review' && !selectedConflictReviewFile)) {
      return
    }
    if (fileToLoad.mode === 'edit' || fileToLoad.mode === 'markdown-preview') {
      if (fileToLoad.conflict?.kind === 'conflict-placeholder') {
        return
      }
      if (needsFileRead(fileToLoad.id)) {
        void loadFileContent(
          fileToLoad.filePath,
          fileToLoad.id,
          fileToLoad.worktreeId,
          fileToLoad.relativePath,
          shouldForceFileRead(fileToLoad.id) ? { force: true, ...load } : load
        )
      }
      if (
        (isChangesMode || (baselineScope !== null && baselineFileReady)) &&
        needsDiffRead(fileToLoad.id)
      ) {
        void loadDiffContent(fileToLoad)
      }
    } else if (isReloadableSingleFileDiffTab(fileToLoad) && needsDiffRead(fileToLoad.id)) {
      void loadDiffContent(fileToLoad)
    }
    if (needsWorkingDiffDocument && needsFileRead(fileToLoad.id)) {
      void loadFileContent(
        fileToLoad.filePath,
        fileToLoad.id,
        fileToLoad.worktreeId,
        fileToLoad.relativePath
      )
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeFile?.id,
    activeFile?.mode,
    activeFile?.conflictReview?.selectedFileId,
    activeFile?.conflictReview?.snapshotTimestamp,
    selectedConflictReviewFile?.id,
    isChangesMode,
    baselineScope,
    baselineFileReady,
    needsWorkingDiffDocument,
    activeFile?.filePath,
    activeFile?.runtimeEnvironmentId,
    isVisible,
    gitStatusEntries
  ])
}
