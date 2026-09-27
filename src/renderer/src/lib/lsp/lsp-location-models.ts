import type * as Monaco from 'monaco-editor'
import { detectLanguage } from '@/lib/language-detect'
import type { LspWorkspaceSession } from './lsp-client'
import { getLspBindingForUri } from './lsp-document-binding'
import { lspUriFromPath, pathFromLspUri } from './lsp-file-uri'

type MonacoModule = typeof Monaco

const PREVIEW_MODEL_LIMIT = 50
// Insertion order doubles as LRU order.
const previewModels = new Map<string, Monaco.editor.ITextModel>()
const previewModelSet = new WeakSet<Monaco.editor.ITextModel>()

/** Disk snapshot backing a peek preview; edits to it would never be saved. */
export function isLspLocationPreviewModel(model: Monaco.editor.ITextModel | null): boolean {
  return model !== null && previewModelSet.has(model)
}

async function ensurePreviewModel(
  monaco: MonacoModule,
  uri: Monaco.Uri,
  filePath: string
): Promise<void> {
  const key = uri.toString()
  const cached = previewModels.get(key)
  if (!cached && monaco.editor.getModel(uri)) {
    return
  }
  let content: string
  try {
    const result = await window.api.fs.readFile({ filePath })
    if (result.isBinary) {
      return
    }
    content = result.content
  } catch {
    return
  }
  const current = previewModels.get(key)
  if (current && !current.isDisposed()) {
    if (current.getValue() !== content) {
      current.setValue(content)
    }
    previewModels.delete(key)
    previewModels.set(key, current)
    return
  }
  if (monaco.editor.getModel(uri)) {
    return
  }
  const model = monaco.editor.createModel(content, detectLanguage(filePath), uri)
  previewModelSet.add(model)
  previewModels.set(key, model)
  model.onWillDispose(() => {
    if (previewModels.get(key) === model) {
      previewModels.delete(key)
    }
  })
}

function evictPreviewModels(keep: Set<string>): void {
  for (const [key, model] of previewModels) {
    if (previewModels.size <= PREVIEW_MODEL_LIMIT) {
      return
    }
    if (keep.has(key) || model.isAttachedToEditor()) {
      continue
    }
    previewModels.delete(key)
    model.dispose()
  }
}

/** Point LSP locations at resolvable Monaco models: open documents map to their
 *  working-document model, other files get a read-only disk preview model.
 *  Why: standalone Monaco's peek/preview only resolves already-existing models. */
export async function resolveLspLocationModels(
  monaco: MonacoModule,
  session: LspWorkspaceSession,
  locations: Monaco.languages.Location[]
): Promise<Monaco.languages.Location[]> {
  const uriByLspUri = new Map<string, Monaco.Uri>()
  const previewLoads: Promise<void>[] = []
  const keep = new Set<string>()
  for (const location of locations) {
    const lspUri = location.uri.toString()
    if (uriByLspUri.has(lspUri)) {
      continue
    }
    const filePath = pathFromLspUri(lspUri)
    if (!filePath) {
      uriByLspUri.set(lspUri, location.uri)
      continue
    }
    const binding = getLspBindingForUri(session.sessionId, lspUriFromPath(filePath))
    if (binding && !binding.model.isDisposed()) {
      uriByLspUri.set(lspUri, binding.model.uri)
      continue
    }
    uriByLspUri.set(lspUri, location.uri)
    keep.add(lspUri)
    previewLoads.push(ensurePreviewModel(monaco, location.uri, filePath))
  }
  await Promise.all(previewLoads)
  evictPreviewModels(keep)
  return locations.map((location) => ({
    ...location,
    uri: uriByLspUri.get(location.uri.toString()) ?? location.uri
  }))
}
