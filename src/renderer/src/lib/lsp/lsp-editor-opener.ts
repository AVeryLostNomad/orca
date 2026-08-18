import type * as Monaco from 'monaco-editor'
import { useAppStore } from '@/store'
import { detectLanguage } from '@/lib/language-detect'
import { pathFromLspUri } from './lsp-file-uri'
import { getLspBindingForModel } from './lsp-document-binding'

type MonacoModule = typeof Monaco

let installed = false

function relativeToRoot(filePath: string, rootPath: string): string | null {
  const normalizedRoot = rootPath.replace(/[\\/]+$/, '')
  if (filePath === normalizedRoot) {
    return null
  }
  if (filePath.startsWith(`${normalizedRoot}/`) || filePath.startsWith(`${normalizedRoot}\\`)) {
    return filePath.slice(normalizedRoot.length + 1)
  }
  return null
}

// Standalone Monaco cannot open other files itself, so go-to-definition
// targets outside the current model route through Orca's own tab system.
export function installLspEditorOpener(monaco: MonacoModule): void {
  if (installed) {
    return
  }
  installed = true
  monaco.editor.registerEditorOpener({
    openCodeEditor(source, resource, selectionOrPosition) {
      const binding = getLspBindingForModel(source.getModel() as Monaco.editor.ITextModel)
      if (!binding) {
        return false
      }
      const targetPath = pathFromLspUri(resource.toString())
      if (!targetPath) {
        return false
      }
      const relativePath = relativeToRoot(targetPath, binding.session.rootPath)
      if (!relativePath) {
        // Outside the workspace (e.g. node_modules outside root or stdlib):
        // still not openable through worktree tabs today.
        return false
      }
      const range = selectionOrPosition as Monaco.IRange | Monaco.IPosition | undefined
      const line =
        range && 'startLineNumber' in range
          ? range.startLineNumber
          : range && 'lineNumber' in range
            ? range.lineNumber
            : 1
      const column =
        range && 'startColumn' in range
          ? range.startColumn
          : range && 'column' in range
            ? range.column
            : 1
      const state = useAppStore.getState()
      state.setPendingEditorReveal({
        filePath: targetPath,
        line,
        column,
        matchLength: 0
      })
      state.openFile(
        {
          filePath: targetPath,
          relativePath,
          worktreeId: binding.worktreeId,
          language: detectLanguage(targetPath),
          mode: 'edit'
        },
        { preview: true, focusEditor: true }
      )
      return true
    }
  })
}
