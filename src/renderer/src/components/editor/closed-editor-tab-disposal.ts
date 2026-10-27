import type { editor } from 'monaco-editor'
import type { OpenFile } from '@/store/slices/editor'
import { scrollTopCache } from '@/lib/scroll-cache'
import { toEditorModelUri } from './editor-model-uri'

export type DisposableMonacoModel = Pick<editor.ITextModel, 'dispose' | 'isAttachedToEditor'> & {
  uri: { toString(skipEncoding?: boolean): string }
}

export type MonacoModelRegistry = {
  Uri: {
    parse(value: string): unknown
  }
  editor: {
    getModel(uri: unknown): DisposableMonacoModel | null
    getModels(): DisposableMonacoModel[]
  }
}

export type ClosedEditorTab = Pick<OpenFile, 'id' | 'mode' | 'filePath'> & {
  modelOwnerKey?: string
}

// Why: Pierre diffs own no Monaco models and working-document models collect themselves; only owner-keyed file models remain.
export function disposeClosedEditorModels(
  monacoRegistry: MonacoModelRegistry,
  closedFiles: readonly ClosedEditorTab[],
  onAttachedModel?: (model: DisposableMonacoModel, file: ClosedEditorTab) => void,
  isStillClosed: (file: ClosedEditorTab) => boolean = () => true
): void {
  for (const closedFile of closedFiles) {
    if (closedFile.mode !== 'edit' || !isStillClosed(closedFile)) {
      continue
    }
    const model = monacoRegistry.editor.getModel(
      monacoRegistry.Uri.parse(toEditorModelUri(closedFile.filePath, closedFile.modelOwnerKey))
    )
    if (model?.isAttachedToEditor()) {
      onAttachedModel?.(model, closedFile)
    } else {
      model?.dispose()
    }
  }
}

export function disposeClosedCheckDetailsReadingCache(
  closedFiles: readonly ClosedEditorTab[],
  isStillClosed: (file: ClosedEditorTab) => boolean = () => true
): void {
  for (const closedFile of closedFiles) {
    if (closedFile.mode !== 'check-details' || !isStillClosed(closedFile)) {
      continue
    }
    for (const key of scrollTopCache.keys()) {
      if (key.startsWith(`${closedFile.id}::`)) {
        scrollTopCache.delete(key)
      }
    }
  }
}
