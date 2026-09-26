import { useCallback, useMemo } from 'react'
import { Editor, type EditorOptions } from '@pierre/diffs/edit'
import type { CreateEditor } from '@pierre/diffs/react'
import type { editor, IDisposable } from 'monaco-editor'
import {
  acquireWorkingDocumentModel,
  attachWorkingDocumentEditor
} from '../editor/working-document-model'
import { useAppStore } from '@/store'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'
import type { PierreDiffAnnotationData } from './pierre-diff-comment-annotations'

const PIERRE_HISTORY_MAX_ENTRIES = 1
let nextSurfaceId = 0

type MonacoContentChangeEvent = {
  changes: readonly {
    range: {
      startLineNumber: number
      startColumn: number
      endLineNumber: number
      endColumn: number
    }
    text: string
  }[]
  versionId: number
}
type PierreEditorOptions = EditorOptions<PierreDiffAnnotationData>

function endPosition(text: string): { line: number; character: number } {
  let line = 0
  let lastLineStart = 0
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
    line++
    lastLineStart = index + 1
  }
  return { line, character: text.length - lastLineStart }
}

function fullTextEdit(currentText: string, nextText: string) {
  return {
    range: {
      start: { line: 0, character: 0 },
      end: endPosition(currentText)
    },
    newText: nextText
  }
}

// Monaco owns input/history; this adapter keeps Pierre's hunk geometry live.
class WorkingDocumentPierreEditor extends Editor<PierreDiffAnnotationData> {
  private readonly documentId: WorkingDocumentId
  private readonly surfaceId: string
  private model: editor.ITextModel | undefined
  private detachSurface: (() => void) | undefined
  private modelSubscription: IDisposable | undefined

  constructor(documentId: WorkingDocumentId, options: PierreEditorOptions) {
    const { onAttach, ...editorOptions } = options
    super({ ...editorOptions, historyMaxEntries: PIERRE_HISTORY_MAX_ENTRIES })
    this.documentId = documentId
    this.surfaceId = `pierre-working-document:${++nextSurfaceId}`
    this.setOptions({
      onAttach: (editor, file) => {
        this.attachModel()
        onAttach?.(editor, file)
      }
    })
  }

  cleanUp(recycle = false): void {
    this.modelSubscription?.dispose()
    this.modelSubscription = undefined
    this.detachSurface?.()
    this.detachSurface = undefined
    this.model = undefined
    super.cleanUp(recycle)
  }

  private attachModel(): void {
    if (this.model) {
      return
    }
    const model = acquireWorkingDocumentModel(this.documentId)
    this.model = model
    this.detachSurface = attachWorkingDocumentEditor(this.documentId, this.surfaceId)
    this.modelSubscription = model.onDidChangeContent((event) => this.applyModelChange(event))
    if (this.getText() !== model.getValue()) {
      this.applyEdits([fullTextEdit(this.getText(), model.getValue())], false)
    }
  }

  private applyModelChange(event: MonacoContentChangeEvent): void {
    this.applyEdits(
      event.changes.map((change) => ({
        range: {
          start: {
            line: change.range.startLineNumber - 1,
            character: change.range.startColumn - 1
          },
          end: {
            line: change.range.endLineNumber - 1,
            character: change.range.endColumn - 1
          }
        },
        newText: change.text
      })),
      false
    )
  }
}

export function usePierreWorkingDocumentEditor({
  workingDocumentId
}: {
  workingDocumentId?: WorkingDocumentId
}): {
  edit: boolean
  editorOptions: EditorOptions<PierreDiffAnnotationData> | undefined
  createEditor: CreateEditor<PierreDiffAnnotationData>
} {
  const document = useAppStore((state) =>
    workingDocumentId ? state.workingDocuments[workingDocumentId] : undefined
  )
  const edit =
    workingDocumentId !== undefined &&
    document?.writable === true &&
    document.loadState === 'ready' &&
    document.content !== undefined

  // Stable through document revisions so Pierre preserves its selection.
  const editorOptions = useMemo<PierreEditorOptions | undefined>(
    () =>
      edit && workingDocumentId
        ? {
            documentKey: workingDocumentId,
            historyMaxEntries: PIERRE_HISTORY_MAX_ENTRIES
          }
        : undefined,
    [edit, workingDocumentId]
  )

  const createEditor = useCallback<CreateEditor<PierreDiffAnnotationData>>(
    (options) => {
      if (!workingDocumentId) {
        throw new Error('A working document is required to create an editable Pierre diff.')
      }
      return new WorkingDocumentPierreEditor(workingDocumentId, options)
    },
    [workingDocumentId]
  )

  return { edit, editorOptions, createEditor }
}
