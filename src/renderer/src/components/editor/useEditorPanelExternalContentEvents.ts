import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { useAppStore } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import {
  getWorkingDocumentsForExternalFileChange,
  ORCA_EDITOR_EXTERNAL_FILE_CHANGE_EVENT,
  ORCA_EDITOR_DOCUMENT_SAVED_EVENT,
  type EditorDocumentSavedDetail,
  type EditorPathMutationTarget
} from './editor-autosave'
import type { DiffContent, FileContent } from './editor-panel-content-types'
import { isReloadableSingleFileDiffTab } from './editor-panel-diff-reload'
import { getEditorGitBaselineScope } from './editor-panel-file-mode'
import { getWorkingDocumentForFile } from '@renderer/store/slices/editor/working-document-state'

type EditorViewModeByFile = ReturnType<typeof useAppStore.getState>['editorViewMode']

export type EditorPanelContentLoadOptions = {
  force?: boolean
  externalEventGeneration?: number
}

type UseEditorPanelExternalContentEventsParams = {
  activeContentFileIdRef: MutableRefObject<string | null>
  invalidateContent: (fileIds: string[]) => void
  invalidateDiffContent: (fileIds: string[]) => void
  isVisibleRef: MutableRefObject<boolean>
  loadDiffContent: (file: OpenFile | null, options?: EditorPanelContentLoadOptions) => Promise<void>
  loadFileContent: (
    filePath: string,
    id: string,
    worktreeId?: string,
    relativePath?: string,
    options?: EditorPanelContentLoadOptions
  ) => Promise<void>
  openFilesRef: MutableRefObject<OpenFile[]>
  editorViewModeRef: MutableRefObject<EditorViewModeByFile>
  setFileContents: Dispatch<SetStateAction<Record<string, FileContent>>>
  setDiffContents: Dispatch<SetStateAction<Record<string, DiffContent>>>
}

const externalEventGenerations = new WeakMap<Event, number>()
let externalEventGenerationCounter = 0

function getExternalEventGeneration(event: Event): number {
  const existing = externalEventGenerations.get(event)
  if (existing !== undefined) {
    return existing
  }
  const generation = ++externalEventGenerationCounter
  externalEventGenerations.set(event, generation)
  return generation
}

export function useEditorPanelExternalContentEvents({
  activeContentFileIdRef,
  invalidateContent,
  invalidateDiffContent,
  isVisibleRef,
  loadDiffContent,
  loadFileContent,
  openFilesRef,
  editorViewModeRef,
  setFileContents
}: UseEditorPanelExternalContentEventsParams): void {
  useEffect(() => {
    const handler = (event: Event): void => {
      const detail = (event as CustomEvent<EditorPathMutationTarget>).detail
      if (!detail) {
        return
      }
      const eventGeneration = getExternalEventGeneration(event)
      const invalidatedDiffFileIds: string[] = []
      const invalidatedFileIds: string[] = []
      const state = useAppStore.getState()
      const documentIds = new Set(
        getWorkingDocumentsForExternalFileChange(state.workingDocuments, detail).map(
          (document) => document.id
        )
      )
      const files = openFilesRef.current.filter((file) => {
        const document = getWorkingDocumentForFile(state, file.id)
        return document && documentIds.has(document.id)
      })
      for (const file of files) {
        const hasBaseline = getEditorGitBaselineScope(state, file) !== null
        if (hasBaseline) {
          if (isVisibleRef.current && file.id === activeContentFileIdRef.current) {
            void loadDiffContent(file, { force: true, externalEventGeneration: eventGeneration })
          } else {
            invalidatedDiffFileIds.push(file.id)
          }
        }
        // Why: a dirty file keeps its unsaved buffer (issue #7265) — it is
        // marked changed-on-disk upstream and resolves via the editor banner,
        // a save, or a later clean reload. Reloading here would clobber it.
        if (file.isDirty) {
          continue
        }
        if (!isVisibleRef.current || file.id !== activeContentFileIdRef.current) {
          invalidatedFileIds.push(file.id)
          continue
        }
        if (file.mode === 'edit' || file.mode === 'markdown-preview') {
          // Why: external writes must replace any in-flight pre-change read so
          // the tab shows the new on-disk content, not a stale dedupe result.
          void loadFileContent(file.filePath, file.id, file.worktreeId, file.relativePath, {
            force: true,
            externalEventGeneration: eventGeneration
          })
          if (!hasBaseline && editorViewModeRef.current[file.id] === 'changes') {
            void loadDiffContent(file, {
              force: true,
              externalEventGeneration: eventGeneration
            })
          } else if (!hasBaseline) {
            invalidatedDiffFileIds.push(file.id)
          }
        } else if (isReloadableSingleFileDiffTab(file)) {
          void loadDiffContent(file, {
            force: true,
            externalEventGeneration: eventGeneration
          })
        }
      }
      if (invalidatedFileIds.length > 0) {
        invalidateContent(invalidatedFileIds)
      }
      if (invalidatedDiffFileIds.length > 0) {
        invalidateDiffContent(invalidatedDiffFileIds)
      }
    }
    window.addEventListener(ORCA_EDITOR_EXTERNAL_FILE_CHANGE_EVENT, handler as EventListener)
    return () =>
      window.removeEventListener(ORCA_EDITOR_EXTERNAL_FILE_CHANGE_EVENT, handler as EventListener)
  }, [
    activeContentFileIdRef,
    editorViewModeRef,
    invalidateContent,
    invalidateDiffContent,
    isVisibleRef,
    loadDiffContent,
    loadFileContent,
    openFilesRef
  ])

  useEffect(() => {
    const handler = (event: Event): void => {
      const detail = (event as CustomEvent<EditorDocumentSavedDetail>).detail
      if (!detail) {
        return
      }
      const state = useAppStore.getState()
      const files = openFilesRef.current.filter(
        (file) => getWorkingDocumentForFile(state, file.id)?.id === detail.documentId
      )
      if (!files.length) {
        return
      }
      setFileContents((previous) => {
        const next = { ...previous }
        for (const file of files) {
          next[file.id] = { content: detail.content, isBinary: false }
        }
        return next
      })
      invalidateDiffContent(files.map((file) => file.id))
      const active = files.find((file) => file.id === activeContentFileIdRef.current)
      if (active && isVisibleRef.current) {
        void loadDiffContent(active, { force: true })
      }
    }
    window.addEventListener(ORCA_EDITOR_DOCUMENT_SAVED_EVENT, handler as EventListener)
    return () =>
      window.removeEventListener(ORCA_EDITOR_DOCUMENT_SAVED_EVENT, handler as EventListener)
  }, [
    openFilesRef,
    setFileContents,
    invalidateDiffContent,
    activeContentFileIdRef,
    isVisibleRef,
    loadDiffContent
  ])
}

export function usePruneClosedEditorContent(
  openFiles: OpenFile[],
  fileLoadRetryAttemptsRef: MutableRefObject<Record<string, number>>,
  fileReadGenerationRef: MutableRefObject<Record<string, number>>,
  diffReadGenerationRef: MutableRefObject<Record<string, number>>,
  setFileContents: Dispatch<SetStateAction<Record<string, FileContent>>>,
  setDiffContents: Dispatch<SetStateAction<Record<string, DiffContent>>>
): void {
  const knownOpenFileIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const openIds = new Set(openFiles.map((f) => f.id))
    for (const fileId of openIds) {
      knownOpenFileIdsRef.current.add(fileId)
    }
    for (const fileId of Object.keys(fileLoadRetryAttemptsRef.current)) {
      if (!openIds.has(fileId)) {
        delete fileLoadRetryAttemptsRef.current[fileId]
      }
    }
    // Why: conflict-review entry loads use absolute paths as content ids; only
    // ids that have belonged to tabs are safe to prune as closed tabs.
    for (const fileId of Object.keys(fileReadGenerationRef.current)) {
      if (knownOpenFileIdsRef.current.has(fileId) && !openIds.has(fileId)) {
        delete fileReadGenerationRef.current[fileId]
      }
    }
    for (const fileId of Object.keys(diffReadGenerationRef.current)) {
      if (knownOpenFileIdsRef.current.has(fileId) && !openIds.has(fileId)) {
        delete diffReadGenerationRef.current[fileId]
      }
    }
    setFileContents((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([key]) => openIds.has(key)))
    )
    setDiffContents((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([key]) => openIds.has(key)))
    )
  }, [
    diffReadGenerationRef,
    fileLoadRetryAttemptsRef,
    fileReadGenerationRef,
    knownOpenFileIdsRef,
    openFiles,
    setDiffContents,
    setFileContents
  ])
}
