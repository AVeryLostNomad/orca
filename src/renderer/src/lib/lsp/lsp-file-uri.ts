import { URI } from 'vscode-uri'

/** Canonical LSP `file:` URI for an absolute path (Windows drive letters get
 *  percent-encoded correctly, e.g. file:///c%3A/...). */
export function lspUriFromPath(filePath: string): string {
  return URI.file(filePath).toString()
}

export function pathFromLspUri(uri: string): string | null {
  try {
    const parsed = URI.parse(uri)
    return parsed.scheme === 'file' ? parsed.fsPath : null
  } catch {
    return null
  }
}
