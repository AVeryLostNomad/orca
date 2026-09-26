/** One tab's migration in an Orca-owned move; precomputed by the move coordinator. */
export type OpenFilePathRekey = {
  oldFileId: string
  newFileId: string
  oldFilePath: string
  newFilePath: string
  newRelativePath: string
  newLanguage?: string
  newMarkdownPreviewSourceFileId?: string
  /** Explicit rename of an untitled file consumes its untitled status. */
  consumeUntitled?: boolean
}

/** A retained document without its own ordinary tab (for example, a combined section). */
export type WorkingDocumentPathRekey = {
  documentId: string
  oldFilePath: string
  newFilePath: string
  newRelativePath: string
  newLanguage?: string
}

export type RekeyOpenFilesResult = { ok: true } | { ok: false; reason: 'collision' | 'stale' }
