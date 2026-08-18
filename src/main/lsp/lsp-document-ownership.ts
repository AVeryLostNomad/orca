// Multi-window arbitration for a shared LSP session: exactly one webContents
// owns each open document, so a second window's duplicate didOpen (or a
// non-owner's didChange) never desyncs the server's copy.

export function lspDocumentUriOf(params: unknown): string | null {
  const uri = (params as { textDocument?: { uri?: unknown } } | null)?.textDocument?.uri
  return typeof uri === 'string' ? uri : null
}

export type LspDocumentNotificationRouting = {
  forward: boolean
  /** True when this notification closed the session's last open document. */
  closedLast: boolean
}

export function routeLspDocumentNotification(
  openDocuments: Map<string, number>,
  method: string,
  params: unknown,
  webContentsId: number
): LspDocumentNotificationRouting {
  const uri = lspDocumentUriOf(params)
  if (!uri) {
    return { forward: true, closedLast: false }
  }
  if (method === 'textDocument/didOpen') {
    const owner = openDocuments.get(uri)
    if (owner !== undefined && owner !== webContentsId) {
      return { forward: false, closedLast: false }
    }
    openDocuments.set(uri, webContentsId)
    return { forward: true, closedLast: false }
  }
  if (method === 'textDocument/didClose') {
    if (openDocuments.get(uri) !== webContentsId) {
      return { forward: false, closedLast: false }
    }
    openDocuments.delete(uri)
    return { forward: true, closedLast: openDocuments.size === 0 }
  }
  if (method === 'textDocument/didChange' || method === 'textDocument/didSave') {
    return { forward: openDocuments.get(uri) === webContentsId, closedLast: false }
  }
  return { forward: true, closedLast: false }
}

/** Remove every document a departed webContents owned; returns their uris so
 *  the caller can send the didClose notifications. */
export function takeLspDocumentsOwnedBy(
  openDocuments: Map<string, number>,
  webContentsId: number
): string[] {
  const closed: string[] = []
  for (const [uri, owner] of openDocuments) {
    if (owner === webContentsId) {
      openDocuments.delete(uri)
      closed.push(uri)
    }
  }
  return closed
}
