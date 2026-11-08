import { URI } from 'vscode-uri'

// Roslyn fails on percent-encoded drive colons (file:///c%3A/...) — hover
// returns null and pull diagnostics throw UriFormatException — so, like
// vscode-csharp, it gets unencoded URIs.
const UNENCODED_URI_SERVERS: Record<string, true> = { csharp: true }

/** `file:` URI for an absolute path in the form `serverId` expects: canonical
 *  LSP encoding (file:///c%3A/...) unless the server needs it unencoded. */
export function lspUriFromPath(filePath: string, serverId: string): string {
  return URI.file(filePath).toString(UNENCODED_URI_SERVERS[serverId] === true)
}

/** Encoding-independent identity for comparing URIs servers send back. */
export function canonicalLspUri(uri: string): string {
  try {
    return URI.parse(uri).toString()
  } catch {
    return uri
  }
}

export function pathFromLspUri(uri: string): string | null {
  try {
    const parsed = URI.parse(uri)
    return parsed.scheme === 'file' ? parsed.fsPath : null
  } catch {
    return null
  }
}
