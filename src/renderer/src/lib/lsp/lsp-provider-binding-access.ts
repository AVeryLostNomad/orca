import type * as Monaco from 'monaco-editor'
import type { LspWorkspaceSession } from './lsp-client'
import { getLspBindingForModel, type LspDocumentBinding } from './lsp-document-binding'
import { toLspPosition } from './lsp-monaco-converters'

export function lspBindingFor(model: Monaco.editor.ITextModel): LspDocumentBinding | undefined {
  return getLspBindingForModel(model)
}

export function lspCapability<T>(session: LspWorkspaceSession, key: string): T | undefined {
  return session.capabilities[key] as T | undefined
}

export function lspPositionParams(
  binding: LspDocumentBinding,
  position: Monaco.IPosition
): { textDocument: { uri: string }; position: { line: number; character: number } } {
  return { textDocument: { uri: binding.uri }, position: toLspPosition(position) }
}
