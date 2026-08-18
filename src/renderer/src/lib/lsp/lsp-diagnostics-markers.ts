import type * as Monaco from 'monaco-editor'
import type { Diagnostic } from 'vscode-languageserver-protocol'
import { getLspBindingForUri } from './lsp-document-binding'
import { toMonacoMarker } from './lsp-monaco-converters'
import { onLspNotification, type LspWorkspaceSession } from './lsp-client'

type MonacoModule = typeof Monaco

const subscribedSessionIds = new Set<string>()

export function markerOwnerForServer(serverId: string): string {
  return `lsp:${serverId}`
}

/** Route a session's publishDiagnostics pushes onto the bound models. */
export function ensureLspDiagnosticsSubscription(
  monaco: MonacoModule,
  session: LspWorkspaceSession
): void {
  if (subscribedSessionIds.has(session.sessionId)) {
    return
  }
  subscribedSessionIds.add(session.sessionId)
  onLspNotification(session, 'textDocument/publishDiagnostics', (params) => {
    const payload = params as { uri?: string; diagnostics?: Diagnostic[] } | null
    if (!payload?.uri) {
      return
    }
    const binding = getLspBindingForUri(session.sessionId, payload.uri)
    if (!binding || binding.model.isDisposed()) {
      return
    }
    monaco.editor.setModelMarkers(
      binding.model,
      markerOwnerForServer(session.serverId),
      (payload.diagnostics ?? []).map(toMonacoMarker)
    )
  })
}

export function clearLspMarkersForModel(
  monaco: MonacoModule,
  model: Monaco.editor.ITextModel,
  serverId: string
): void {
  if (!model.isDisposed()) {
    monaco.editor.setModelMarkers(model, markerOwnerForServer(serverId), [])
  }
}
