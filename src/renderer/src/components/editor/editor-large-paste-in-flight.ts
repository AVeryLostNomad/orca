// Chunked pastes publish drafts only at completion; hold saves across every tab sharing the model URI to avoid writing outdated text.
const pastesInFlight = new Map<string, number>()

export function beginEditorLargePaste(modelUri: string): () => void {
  pastesInFlight.set(modelUri, (pastesInFlight.get(modelUri) ?? 0) + 1)
  let ended = false
  return () => {
    if (ended) {
      return
    }
    ended = true
    const remaining = (pastesInFlight.get(modelUri) ?? 1) - 1
    if (remaining > 0) {
      pastesInFlight.set(modelUri, remaining)
    } else {
      pastesInFlight.delete(modelUri)
    }
  }
}

export function isEditorLargePasteInFlight(modelUri: string): boolean {
  return pastesInFlight.has(modelUri)
}

// Working-document models have registry-owned URIs; saves look them up by document id.
const documentModelUris = new Map<string, string>()

export function setWorkingDocumentModelUri(documentId: string, modelUri: string | null): void {
  if (modelUri === null) {
    documentModelUris.delete(documentId)
  } else {
    documentModelUris.set(documentId, modelUri)
  }
}

/** A chunked paste into the document's shared model holds its saves until the paste completes. */
export function isWorkingDocumentLargePasteInFlight(documentId: string): boolean {
  const modelUri = documentModelUris.get(documentId)
  return modelUri !== undefined && pastesInFlight.has(modelUri)
}
