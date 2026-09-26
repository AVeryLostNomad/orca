import type { Uri } from 'monaco-editor'
import type { OpenFile } from '@/store/slices/editor'
import { editorSelectionCache, pdfViewPositionCache, scrollTopCache } from '@/lib/scroll-cache'
import {
  deletePaneScopedCacheEntries,
  sweepClosedPdfViewPositions
} from './closed-editor-tab-cache-sweep'

type EditorModelRegistry = {
  editor: {
    getModel: (uri: Uri) => { isAttachedToEditor: () => boolean; dispose: () => void } | null
  }
  Uri: { parse: (value: string) => Uri }
}

/** Releases cache entries owned by a batch of closed tabs. */
export function disposeClosedEditorTabs(
  monacoRegistry: EditorModelRegistry,
  closedFiles: readonly OpenFile[]
): void {
  if (closedFiles.length === 0) {
    return
  }

  const scrollTopOwners: string[] = []
  const editorSelectionOwners: string[] = []
  const closedPdfFilePaths: string[] = []

  for (const closedFile of closedFiles) {
    switch (closedFile.mode) {
      case 'edit': {
        if (closedFile.readOnly) {
          const model = monacoRegistry.editor.getModel(
            monacoRegistry.Uri.parse(closedFile.filePath)
          )
          if (model && !model.isAttachedToEditor()) {
            model.dispose()
          }
        }
        scrollTopCache.delete(closedFile.filePath)
        scrollTopCache.delete(`${closedFile.filePath}:rich`)
        scrollTopCache.delete(`${closedFile.filePath}:preview`)
        scrollTopCache.delete(`${closedFile.filePath}:mermaid-diagram`)
        editorSelectionCache.delete(closedFile.filePath)
        scrollTopOwners.push(closedFile.filePath)
        editorSelectionOwners.push(closedFile.filePath)
        closedPdfFilePaths.push(closedFile.filePath)
        break
      }
      case 'diff':
      case 'markdown-preview':
        scrollTopCache.delete(`${closedFile.id}:preview`)
        scrollTopOwners.push(closedFile.id)
        break
      case 'conflict-review':
      case 'check-details':
        break
    }
  }

  deletePaneScopedCacheEntries(scrollTopCache, scrollTopOwners)
  deletePaneScopedCacheEntries(editorSelectionCache, editorSelectionOwners)
  sweepClosedPdfViewPositions(pdfViewPositionCache, closedPdfFilePaths)
}
