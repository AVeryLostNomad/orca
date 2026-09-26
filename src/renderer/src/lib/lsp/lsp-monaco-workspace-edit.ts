import type * as Monaco from 'monaco-editor'
import type { TextEdit, WorkspaceEdit } from 'vscode-languageserver-protocol'
import { getLspBindingForUri } from './lsp-document-binding'
import { registerLspServerRequestHandler, type LspWorkspaceSession } from './lsp-client'
import { toMonacoRange } from './lsp-monaco-converters'

type MonacoModule = typeof Monaco

type TextEditsForDocument = {
  edits: TextEdit[]
  lspVersion?: number
}

type ResolvedWorkspaceEdit = {
  edits: Monaco.languages.WorkspaceEdit
  changes: {
    model: Monaco.editor.ITextModel
    edits: TextEdit[]
    modelVersion: number
  }[]
}

export type MonacoWorkspaceEditResult =
  | { workspaceEdit: Monaco.languages.WorkspaceEdit; failureReason?: never }
  | { workspaceEdit?: never; failureReason: string }

function collectTextEdits(
  workspaceEdit: WorkspaceEdit
): Map<string, TextEditsForDocument> | { failureReason: string } {
  const editsByUri = new Map<string, TextEditsForDocument>()
  if (workspaceEdit.documentChanges) {
    for (const change of workspaceEdit.documentChanges) {
      if (!('textDocument' in change)) {
        return { failureReason: 'This action changes files, which Orca does not support yet' }
      }
      const version = change.textDocument.version ?? undefined
      const existing = editsByUri.get(change.textDocument.uri)
      if (existing && existing.lspVersion !== version) {
        return { failureReason: 'This action has conflicting document versions' }
      }
      editsByUri.set(change.textDocument.uri, {
        edits: [...(existing?.edits ?? []), ...(change.edits as TextEdit[])],
        lspVersion: version
      })
    }
    return editsByUri
  }
  for (const [uri, edits] of Object.entries(workspaceEdit.changes ?? {})) {
    editsByUri.set(uri, { edits })
  }
  return editsByUri
}

function resolveWorkspaceEdit(
  monaco: MonacoModule,
  session: LspWorkspaceSession,
  workspaceEdit: WorkspaceEdit
): ResolvedWorkspaceEdit | { failureReason: string } {
  const editsByUri = collectTextEdits(workspaceEdit)
  if ('failureReason' in editsByUri) {
    return editsByUri
  }
  const changes: ResolvedWorkspaceEdit['changes'] = []
  const edits: Monaco.languages.IWorkspaceTextEdit[] = []
  for (const [uri, documentEdits] of editsByUri) {
    const binding = getLspBindingForUri(session.sessionId, uri)
    if (
      documentEdits.lspVersion !== undefined &&
      (!binding || binding.lspVersion() !== documentEdits.lspVersion)
    ) {
      return { failureReason: 'This action was calculated for an older document version' }
    }
    const model =
      binding && !binding.model.isDisposed()
        ? binding.model
        : monaco.editor.getModel(monaco.Uri.parse(uri))
    if (!model || model.isDisposed()) {
      return { failureReason: 'This action touches a file that is not open in the editor yet' }
    }
    const modelVersion = model.getVersionId()
    changes.push({ model, edits: documentEdits.edits, modelVersion })
    for (const edit of documentEdits.edits) {
      edits.push({
        resource: model.uri,
        versionId: modelVersion,
        textEdit: { range: toMonacoRange(edit.range), text: edit.newText }
      })
    }
  }
  return { edits: { edits }, changes }
}

export function toMonacoWorkspaceEdit(
  monaco: MonacoModule,
  session: LspWorkspaceSession,
  workspaceEdit: WorkspaceEdit
): MonacoWorkspaceEditResult {
  const resolved = resolveWorkspaceEdit(monaco, session, workspaceEdit)
  return 'failureReason' in resolved ? resolved : { workspaceEdit: resolved.edits }
}

export function applyLspWorkspaceEdit(
  monaco: MonacoModule,
  session: LspWorkspaceSession,
  workspaceEdit: WorkspaceEdit
): { applied: boolean; failureReason?: string } {
  const resolved = resolveWorkspaceEdit(monaco, session, workspaceEdit)
  if ('failureReason' in resolved) {
    return { applied: false, failureReason: resolved.failureReason }
  }
  try {
    for (const change of resolved.changes) {
      if (change.model.isDisposed() || change.model.getVersionId() !== change.modelVersion) {
        return {
          applied: false,
          failureReason: 'This action was calculated for an older document version'
        }
      }
    }
    for (const change of resolved.changes) {
      change.model.pushStackElement()
      change.model.pushEditOperations(
        [],
        change.edits.map((edit) => ({ range: toMonacoRange(edit.range), text: edit.newText })),
        () => null
      )
      change.model.pushStackElement()
    }
    return { applied: true }
  } catch (error) {
    return {
      applied: false,
      failureReason: error instanceof Error ? error.message : String(error)
    }
  }
}

/** Install the renderer-side half of LSP workspace/applyEdit for server commands. */
export function ensureLspWorkspaceEditHandler(monaco: MonacoModule): void {
  registerLspServerRequestHandler('workspace/applyEdit', async (session, params) => {
    const edit = (params as { edit?: WorkspaceEdit } | null)?.edit
    if (!edit) {
      return { applied: false, failureReason: 'Language server supplied no workspace edit' }
    }
    return applyLspWorkspaceEdit(monaco, session, edit)
  })
}
