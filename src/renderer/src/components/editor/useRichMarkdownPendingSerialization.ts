import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type FocusEvent,
  type MutableRefObject
} from 'react'
import type { Editor } from '@tiptap/react'
import { useAppStore } from '@/store'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'
import { registerPendingEditorFlush } from './editor-pending-flush'
import { focusLeftView, staleViewEditEpoch } from './editor-stale-view-edit'
import { commitRichMarkdownSerialization } from './rich-markdown-serialization-commit'

type PendingSerializationParams = {
  fileId: string
  documentId: WorkingDocumentId
  surfaceId: string
  /** The document revision this ProseMirror doc last synchronized from. */
  synchronizedRevision: number
  synchronizedRevisionRef: MutableRefObject<number>
  editorRef: MutableRefObject<Editor | null>
  lastCommittedMarkdownRef: MutableRefObject<string>
  originalSourceRef: MutableRefObject<string>
  baseCanonicalRef: MutableRefObject<string>
  onContentChangeRef: MutableRefObject<(content: string) => void>
  reconcileRoundTripRef: MutableRefObject<(markdown: string) => string | null>
}

/** Owns the rich view's debounced serialization: commit, stale-edit rejection, and flush triggers. */
export function useRichMarkdownPendingSerialization({
  fileId,
  documentId,
  surfaceId,
  synchronizedRevision,
  synchronizedRevisionRef,
  editorRef,
  lastCommittedMarkdownRef,
  originalSourceRef,
  baseCanonicalRef,
  onContentChangeRef,
  reconcileRoundTripRef
}: PendingSerializationParams) {
  const serializeTimerRef = useRef<number | null>(null)
  // Why: the discard epoch when the pending edit began; a Discard since then drops it silently.
  const pendingEditEpochRef = useRef(0)
  const flushPendingSerialization = useCallback((): boolean => {
    if (serializeTimerRef.current === null) {
      return false
    }
    window.clearTimeout(serializeTimerRef.current)
    serializeTimerRef.current = null
    if (pendingEditEpochRef.current !== staleViewEditEpoch(fileId)) {
      // Why: a Discard since typing began owns the text and dirty flag now.
      return true
    }
    // Why: another surface advanced the canonical document; this serialization is stale.
    if (
      useAppStore.getState().workingDocuments[documentId]?.revision !==
      synchronizedRevisionRef.current
    ) {
      return true
    }
    try {
      const { markdown, didSerialize } = commitRichMarkdownSerialization(
        editorRef.current,
        { originalSourceRef, baseCanonicalRef, lastCommittedMarkdownRef },
        reconcileRoundTripRef.current
      )
      if (didSerialize) {
        onContentChangeRef.current(markdown)
      }
    } catch (error) {
      // Why: teardown and reconcile failures are handled above; other failures must stay observable.
      console.error('[editor] rich markdown serialize (flush) failed', error)
    }
    return false
  }, [
    fileId,
    documentId,
    synchronizedRevisionRef,
    editorRef,
    lastCommittedMarkdownRef,
    originalSourceRef,
    baseCanonicalRef,
    onContentChangeRef,
    reconcileRoundTripRef
  ])

  useEffect(() => {
    // Register as a producer of the canonical document at the revision it last synchronized.
    return registerPendingEditorFlush(documentId, surfaceId, synchronizedRevision, () => {
      flushPendingSerialization()
    })
  }, [documentId, surfaceId, synchronizedRevision, flushPendingSerialization])

  // Flush in layout cleanup before Tiptap’s passive cleanup destroys the editor on tab/mode changes.
  useLayoutEffect(() => {
    return () => {
      flushPendingSerialization()
    }
  }, [flushPendingSerialization])

  const flushOnFocusLeave = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      if (focusLeftView(event)) {
        flushPendingSerialization()
      }
    },
    [flushPendingSerialization]
  )

  return {
    serializeTimerRef,
    pendingEditEpochRef,
    flushPendingSerialization,
    flushOnFocusLeave
  }
}
