import type * as Monaco from 'monaco-editor'
import type { Diagnostic } from 'vscode-languageserver-protocol'
import { getLspBindingForUri } from './lsp-document-binding'
import { toMonacoMarker } from './lsp-monaco-converters'
import { onLspNotification, type LspWorkspaceSession } from './lsp-client'

type MonacoModule = typeof Monaco

type ModelDiagnostics = { push: Monaco.editor.IMarkerData[]; pull: Monaco.editor.IMarkerData[] }

const subscribedSessionIds = new Set<string>()
const diagnosticsByModel = new WeakMap<Monaco.editor.ITextModel, ModelDiagnostics>()

export function markerOwnerForServer(serverId: string): string {
  return `lsp:${serverId}`
}

/** Write one diagnostics channel into the server's marker owner. Servers may
 *  push some diagnostics and serve others by pull (rust-analyzer: flycheck vs
 *  native), so each channel replaces only its own half. */
export function setLspDiagnosticsForModel(
  monaco: MonacoModule,
  model: Monaco.editor.ITextModel,
  serverId: string,
  channel: keyof ModelDiagnostics,
  diagnostics: Diagnostic[]
): void {
  if (model.isDisposed()) {
    return
  }
  let current = diagnosticsByModel.get(model)
  if (!current) {
    current = { push: [], pull: [] }
    diagnosticsByModel.set(model, current)
  }
  current[channel] = diagnostics.map(toMonacoMarker)
  monaco.editor.setModelMarkers(model, markerOwnerForServer(serverId), [
    ...current.push,
    ...current.pull
  ])
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
    if (!binding) {
      return
    }
    setLspDiagnosticsForModel(
      monaco,
      binding.model,
      session.serverId,
      'push',
      payload.diagnostics ?? []
    )
  })
}

export function clearLspMarkersForModel(
  monaco: MonacoModule,
  model: Monaco.editor.ITextModel,
  serverId: string
): void {
  if (!model.isDisposed()) {
    diagnosticsByModel.delete(model)
    monaco.editor.setModelMarkers(model, markerOwnerForServer(serverId), [])
  }
}
