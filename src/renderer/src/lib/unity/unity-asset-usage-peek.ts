import type * as Monaco from 'monaco-editor'
import { StandaloneServices } from 'monaco-editor/esm/vs/editor/standalone/browser/standaloneServices.js'
import { ICommandService } from 'monaco-editor/esm/vs/platform/commands/common/commands.js'
import type { UnityAssetUsage } from '../../../../shared/unity-types'
import { useAppStore } from '@/store'
import { detectLanguage } from '@/lib/language-detect'
import { getRelativePathInsideRoot } from '@/lib/path'
import { lspEditorForModel } from '@/lib/lsp/lsp-client-commands'
import { getLspBindingForModel } from '@/lib/lsp/lsp-document-binding'
import { pathFromLspUri } from '@/lib/lsp/lsp-file-uri'
import { resolveLspLocationModels } from '@/lib/lsp/lsp-location-models'
import { scheduleEditorLineReveal } from '@/store/slices/editor/focus/editor-focus-reveal'
import { unityInsightForModel } from './unity-insight-model-state'

type MonacoModule = typeof Monaco

export const SHOW_UNITY_ASSET_USAGES_COMMAND = 'orca.unity.showAssetUsages'

export type ShowUnityAssetUsagesArgs = {
  modelUri: string
  /** 1-based position the peek widget anchors to. */
  lineNumber: number
  column: number
  usages: UnityAssetUsage[]
}

let installed = false

async function showAssetUsages(
  monaco: MonacoModule,
  args: ShowUnityAssetUsagesArgs
): Promise<void> {
  const model = monaco.editor.getModel(monaco.Uri.parse(args.modelUri))
  const editor = model ? lspEditorForModel(monaco, model) : undefined
  if (!model || !editor || args.usages.length === 0) {
    return
  }
  const locations = await resolveLspLocationModels(
    monaco,
    getLspBindingForModel(model)?.session,
    args.usages.map((usage) => ({
      uri: monaco.Uri.file(usage.assetPath),
      range: new monaco.Range(usage.line, 1, usage.line, 1)
    }))
  )
  const position = { lineNumber: args.lineNumber, column: args.column }
  editor.setPosition(position)
  editor.focus()
  // Standalone Monaco only exposes its peek widget through the command service.
  const commands = StandaloneServices.get<{
    executeCommand(id: string, ...args: unknown[]): Promise<unknown>
  }>(ICommandService)
  await commands.executeCommand(
    'editor.action.peekLocations',
    model.uri,
    position,
    locations,
    'peek'
  )
}

/** Peek-entry navigation for Unity files without an LSP binding (the LSP opener covers bound ones). */
function openAssetFromUnityModel(
  source: Monaco.editor.ICodeEditor,
  resource: Monaco.Uri,
  selectionOrPosition: Monaco.IRange | Monaco.IPosition | undefined
): boolean {
  const sourceModel = source.getModel()
  const insight = sourceModel ? unityInsightForModel(sourceModel) : undefined
  if (!sourceModel || !insight?.workspaceRoot || getLspBindingForModel(sourceModel)) {
    return false
  }
  const targetPath = pathFromLspUri(resource.toString())
  const relativePath = targetPath
    ? getRelativePathInsideRoot(targetPath, insight.workspaceRoot)
    : null
  if (!targetPath || !relativePath) {
    return false
  }
  const line =
    selectionOrPosition && 'startLineNumber' in selectionOrPosition
      ? selectionOrPosition.startLineNumber
      : (selectionOrPosition?.lineNumber ?? 1)
  const store = useAppStore.getState()
  const fileId = store.openFile(
    {
      filePath: targetPath,
      relativePath,
      worktreeId: insight.worktreeId,
      language: detectLanguage(targetPath),
      mode: 'edit'
    },
    { preview: true, focusEditor: true }
  )
  scheduleEditorLineReveal(useAppStore.getState, targetPath, line, 1, fileId)
  return true
}

export function ensureUnityAssetUsagePeek(monaco: MonacoModule): void {
  if (installed) {
    return
  }
  installed = true
  monaco.editor.registerCommand(
    SHOW_UNITY_ASSET_USAGES_COMMAND,
    (_accessor, args: ShowUnityAssetUsagesArgs | undefined) => {
      if (args) {
        void showAssetUsages(monaco, args)
      }
    }
  )
  monaco.editor.registerEditorOpener({ openCodeEditor: openAssetFromUnityModel })
}
