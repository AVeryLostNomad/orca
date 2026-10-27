import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { registerPendingEditorFlush } from './editor-pending-flush'
import { cancelStructuralFrames, requestStructuralFrame } from './ipynb-structural-frames'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'
import {
  focusLeftView,
  notifyStaleViewEditRejected,
  staleViewEditEpoch
} from './editor-stale-view-edit'
import {
  deleteIpynbCell,
  insertIpynbCell,
  moveIpynbCell,
  updateIpynbCellKind,
  updateIpynbCellSources
} from './ipynb-cell-mutations'
import { parseIpynb, type IpynbCellKind, type ParsedIpynb } from './ipynb-parse'
import {
  getIpynbCellKey,
  rebaseIpynbSourceDrafts,
  type IpynbSourceDraftBase
} from './ipynb-source-drafts'

export { getIpynbCellKey }

const NOTEBOOK_SOURCE_COMMIT_DELAY_MS = 400

export function hasIpynbSourceDraft(drafts: Record<string, string>, key: string): boolean {
  return Object.hasOwn(drafts, key)
}

type UseIpynbDocumentEditingArgs = {
  content: string
  fileId: string
  documentId: WorkingDocumentId
  documentRevision: number
  notebook: ParsedIpynb | null
  onContentChange: (content: string) => void
  onDeactivateEditor: () => void
}

export function useIpynbDocumentEditing({
  content,
  fileId,
  documentId,
  documentRevision,
  notebook,
  onContentChange,
  onDeactivateEditor
}: UseIpynbDocumentEditingArgs) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [sourceDrafts, setSourceDrafts] = useState<Record<string, string>>({})
  const sourceDraftsRef = useRef(sourceDrafts)
  const contentRef = useRef(content)
  const notebookRef = useRef(notebook)
  const onContentChangeRef = useRef(onContentChange)
  const sourceDocumentRevisionRef = useRef(documentRevision)
  const lastCommittedContentRef = useRef(content)
  const [sourceDocumentRevision, setSourceDocumentRevision] = useState(documentRevision)
  const sourceCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Why: each drafted cell's source when typing began; a draft onto a cell changed elsewhere is refused.
  const draftBasesRef = useRef<Record<string, IpynbSourceDraftBase>>({})
  const draftEpochRef = useRef(0)
  const parsedContentRef = useRef(content)
  const structuralFrameIdsRef = useRef<number[]>([])
  useLayoutEffect(() => {
    const hadSourceDrafts = Object.keys(sourceDraftsRef.current).length > 0
    const receivedUnrelatedContent =
      content !== contentRef.current && content !== lastCommittedContentRef.current
    contentRef.current = content
    parsedContentRef.current = content
    notebookRef.current = notebook
    onContentChangeRef.current = onContentChange
    if (hadSourceDrafts && receivedUnrelatedContent) {
      sourceDraftsRef.current = {}
      setSourceDrafts({})
    }
    if (!hadSourceDrafts || receivedUnrelatedContent) {
      sourceDocumentRevisionRef.current = documentRevision
      setSourceDocumentRevision((current) =>
        current === documentRevision ? current : documentRevision
      )
    }
  }, [content, documentRevision, notebook, onContentChange])

  const latestCells = useCallback(() => {
    if (parsedContentRef.current === contentRef.current) {
      return notebookRef.current?.cells ?? null
    }
    try {
      return parseIpynb(contentRef.current).cells
    } catch {
      return null
    }
  }, [])

  const flushSourceDrafts = useCallback((): string => {
    const hadTimer = sourceCommitTimerRef.current !== null
    if (sourceCommitTimerRef.current !== null) {
      clearTimeout(sourceCommitTimerRef.current)
      sourceCommitTimerRef.current = null
    }
    const drafts = sourceDraftsRef.current
    if (Object.keys(drafts).length === 0) {
      draftBasesRef.current = {}
      return contentRef.current
    }
    const cells = latestCells() ?? []
    const discarded = staleViewEditEpoch(fileId) !== draftEpochRef.current
    const rebase = discarded
      ? { updates: [], dropped: Object.keys(drafts), lostTyping: false }
      : rebaseIpynbSourceDrafts(cells, drafts, draftBasesRef.current)
    const nextBases = { ...draftBasesRef.current }
    for (const { key, source } of rebase.updates) {
      nextBases[key] = { source, cellKinds: cells.map((cell) => cell.kind) }
    }
    if (rebase.dropped.length > 0) {
      const nextDrafts = { ...drafts }
      for (const key of rebase.dropped) {
        delete nextDrafts[key]
        delete nextBases[key]
      }
      sourceDraftsRef.current = nextDrafts
      setSourceDrafts(nextDrafts)
      if (rebase.lostTyping) {
        notifyStaleViewEditRejected(fileId, draftEpochRef.current)
      }
    }
    draftBasesRef.current = nextBases
    const nextContent = updateIpynbCellSources(
      contentRef.current,
      rebase.updates.filter(({ index, source }) => source !== cells[index]?.source)
    )
    // Why: unchanged text is republished only to recompute dirty after this view's own typing.
    if (hadTimer || rebase.dropped.length > 0 || nextContent !== contentRef.current) {
      contentRef.current = nextContent
      lastCommittedContentRef.current = nextContent
      onContentChangeRef.current(nextContent)
    }
    return nextContent
  }, [fileId, latestCells])

  const queueSourceDraftCommit = useCallback((): void => {
    if (sourceCommitTimerRef.current !== null) {
      clearTimeout(sourceCommitTimerRef.current)
    }
    sourceCommitTimerRef.current = setTimeout(() => {
      void flushSourceDrafts()
    }, NOTEBOOK_SOURCE_COMMIT_DELAY_MS)
  }, [flushSourceDrafts])

  useEffect(
    () =>
      registerPendingEditorFlush(
        documentId,
        `ipynb:${fileId}`,
        sourceDocumentRevision,
        flushSourceDrafts
      ),
    [documentId, fileId, flushSourceDrafts, sourceDocumentRevision]
  )

  useEffect(() => {
    if (!notebook || Object.keys(sourceDraftsRef.current).length === 0) {
      return
    }
    const nextDrafts = { ...sourceDraftsRef.current }
    let changed = false
    for (const [index, cell] of notebook.cells.entries()) {
      const key = getIpynbCellKey(cell, index)
      if (hasIpynbSourceDraft(nextDrafts, key) && nextDrafts[key] === cell.source) {
        delete nextDrafts[key]
        changed = true
      }
    }
    if (changed) {
      sourceDraftsRef.current = nextDrafts
      setSourceDrafts(nextDrafts)
      draftBasesRef.current = Object.fromEntries(
        Object.entries(draftBasesRef.current).filter(([key]) =>
          hasIpynbSourceDraft(nextDrafts, key)
        )
      )
      if (Object.keys(nextDrafts).length === 0 && sourceCommitTimerRef.current !== null) {
        clearTimeout(sourceCommitTimerRef.current)
        sourceCommitTimerRef.current = null
        onContentChangeRef.current(contentRef.current)
      }
    }
    if (Object.keys(nextDrafts).length === 0) {
      sourceDocumentRevisionRef.current = documentRevision
      setSourceDocumentRevision((current) =>
        current === documentRevision ? current : documentRevision
      )
    }
  }, [documentRevision, notebook])

  const setRootRef = useCallback(
    (node: HTMLDivElement | null): void => {
      rootRef.current = node
      if (node !== null) {
        return
      }
      void flushSourceDrafts()
      cancelStructuralFrames(structuralFrameIdsRef)
    },
    [flushSourceDrafts]
  )

  const flushOnFocusLeave = useCallback(
    (event: { currentTarget: Element; relatedTarget: EventTarget | null }): void => {
      if (sourceCommitTimerRef.current !== null && focusLeftView(event)) {
        void flushSourceDrafts()
      }
    },
    [flushSourceDrafts]
  )

  const applyContent = useCallback((nextContent: string): void => {
    contentRef.current = nextContent
    onContentChangeRef.current(nextContent)
  }, [])

  const updateCellSource = useCallback(
    (index: number, source: string): void => {
      const cell = notebookRef.current?.cells[index]
      if (!cell) {
        return
      }
      const key = getIpynbCellKey(cell, index)
      if (sourceCommitTimerRef.current === null) {
        draftEpochRef.current = staleViewEditEpoch(fileId)
      }
      if (!Object.hasOwn(draftBasesRef.current, key)) {
        draftBasesRef.current = {
          ...draftBasesRef.current,
          [key]: {
            source: cell.source,
            cellKinds: notebookRef.current?.cells.map((candidate) => candidate.kind) ?? []
          }
        }
      }
      const nextDrafts = { ...sourceDraftsRef.current, [key]: source }
      sourceDraftsRef.current = nextDrafts
      setSourceDrafts(nextDrafts)
      queueSourceDraftCommit()
    },
    [fileId, queueSourceDraftCommit]
  )

  const applyStructuralChange = useCallback(
    (getNextContent: (latestContent: string) => string): void => {
      const latestContent = flushSourceDrafts()
      onDeactivateEditor()
      requestStructuralFrame(structuralFrameIdsRef, () => {
        applyContent(getNextContent(latestContent))
      })
    },
    [applyContent, flushSourceDrafts, onDeactivateEditor]
  )

  const updateCellKind = (index: number, kind: IpynbCellKind): void => {
    const language = notebookRef.current?.language ?? 'python'
    applyStructuralChange((latestContent) =>
      updateIpynbCellKind(latestContent, index, kind, language)
    )
  }
  const insertCell = (index: number, kind: IpynbCellKind): void => {
    const language = notebookRef.current?.language ?? 'python'
    applyStructuralChange((latestContent) => insertIpynbCell(latestContent, index, kind, language))
  }
  const moveCell = (index: number, direction: -1 | 1): void => {
    applyStructuralChange((latestContent) => moveIpynbCell(latestContent, index, direction))
  }
  const deleteCell = (index: number): void => {
    applyStructuralChange((latestContent) => deleteIpynbCell(latestContent, index))
  }

  return {
    rootRef,
    setRootRef,
    flushOnFocusLeave,
    sourceDrafts,
    flushSourceDrafts,
    applyContent,
    updateCellSource,
    updateCellKind,
    insertCell,
    moveCell,
    deleteCell
  }
}
