import type * as Monaco from 'monaco-editor'
import type { Range, TextEdit, WorkspaceEdit } from 'vscode-languageserver-protocol'
import { requestLsp } from './lsp-client'
import type { LspDocumentBinding } from './lsp-document-binding'
import { toMonacoRange } from './lsp-monaco-converters'
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
      return toMonacoWorkspaceEdit(monaco, binding, workspaceEdit)
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

// Rename edits limited to open models: standalone Monaco's bulk-edit service
// can only touch models that exist. Cross-file edits through Orca's draft/save
// pipeline are the follow-up phase.
function toMonacoWorkspaceEdit(
  monaco: MonacoModule,
  binding: LspDocumentBinding,
  workspaceEdit: WorkspaceEdit
): Monaco.languages.WorkspaceEdit & { rejectReason?: string } {
  const edits: Monaco.languages.IWorkspaceTextEdit[] = []
  const editsByUri = new Map<string, TextEdit[]>()
  if (workspaceEdit.changes) {
    for (const [uri, textEdits] of Object.entries(workspaceEdit.changes)) {
      editsByUri.set(uri, textEdits)
    }
  }
  for (const change of workspaceEdit.documentChanges ?? []) {
    if ('textDocument' in change) {
      const existing = editsByUri.get(change.textDocument.uri) ?? []
      editsByUri.set(change.textDocument.uri, [...existing, ...(change.edits as TextEdit[])])
    }
  }
  for (const [uri, textEdits] of editsByUri) {
    const resource = monaco.Uri.parse(uri)
    if (!monaco.editor.getModel(resource) && uri !== binding.uri) {
      return {
        edits: [],
        rejectReason: 'Rename touches files that are not open in the editor yet'
      }
    }
    for (const edit of textEdits) {
      edits.push({
        resource,
        versionId: undefined,
        textEdit: { range: toMonacoRange(edit.range), text: edit.newText }
      })
    }
  }
  return { edits }
}
