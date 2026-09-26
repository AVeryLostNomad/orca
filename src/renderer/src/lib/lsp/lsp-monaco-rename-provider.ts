import type * as Monaco from 'monaco-editor'
import type { Range, WorkspaceEdit } from 'vscode-languageserver-protocol'
import { requestLsp } from './lsp-client'
import { toMonacoRange } from './lsp-monaco-converters'
import { toMonacoWorkspaceEdit } from './lsp-monaco-workspace-edit'
import { lspBindingFor, lspCapability, lspPositionParams } from './lsp-provider-binding-access'

type MonacoModule = typeof Monaco

function wordRenameLocation(
  model: Monaco.editor.ITextModel,
  position: Monaco.IPosition
): Monaco.languages.RenameLocation & Monaco.languages.Rejection {
  const word = model.getWordAtPosition(position)
  if (!word) {
    return { rejectReason: 'Nothing to rename here', range: null as never, text: '' }
  }
  return {
    range: {
      startLineNumber: position.lineNumber,
      startColumn: word.startColumn,
      endLineNumber: position.lineNumber,
      endColumn: word.endColumn
    },
    text: word.word
  }
}

export function registerLspRenameProvider(monaco: MonacoModule, languageId: string): void {
  monaco.languages.registerRenameProvider(languageId, {
    async provideRenameEdits(model, position, newName, token) {
      const binding = lspBindingFor(model)
      if (!binding || !lspCapability(binding.session, 'renameProvider')) {
        return null
      }
      const workspaceEdit = await requestLsp<WorkspaceEdit | null>(
        binding.session,
        'textDocument/rename',
        { ...lspPositionParams(binding, position), newName },
        token
      )
      if (!workspaceEdit) {
        return { edits: [], rejectReason: 'Rename produced no edits' }
      }
      const converted = toMonacoWorkspaceEdit(monaco, binding.session, workspaceEdit)
      return converted.workspaceEdit ?? { edits: [], rejectReason: converted.failureReason }
    },
    async resolveRenameLocation(model, position, token) {
      const binding = lspBindingFor(model)
      const renameCapability = binding
        ? lspCapability<{ prepareProvider?: boolean } | boolean>(binding.session, 'renameProvider')
        : undefined
      if (!binding || typeof renameCapability !== 'object' || !renameCapability?.prepareProvider) {
        return wordRenameLocation(model, position)
      }
      const prepared = await requestLsp<
        Range | { range: Range; placeholder: string } | { defaultBehavior: boolean } | null
      >(binding.session, 'textDocument/prepareRename', lspPositionParams(binding, position), token)
      if (!prepared || 'defaultBehavior' in prepared) {
        return wordRenameLocation(model, position)
      }
      if ('range' in prepared && 'placeholder' in prepared) {
        return { range: toMonacoRange(prepared.range), text: prepared.placeholder }
      }
      const range = toMonacoRange(prepared as Range)
      return { range, text: model.getValueInRange(range) }
    }
  })
}
