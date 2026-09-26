import type * as Monaco from 'monaco-editor'
import {
  ORCA_EDITOR_DOCUMENT_SAVED_EVENT,
  type EditorDocumentSavedDetail
} from '@/components/editor/editor-autosave'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'
import { lspUriFromPath } from './lsp-file-uri'
import { toLspRange } from './lsp-monaco-converters'
import {
  notifyLsp,
  onLspSessionStatus,
  type LspSessionLease,
  type LspWorkspaceSession
} from './lsp-client'

export type LspDocumentBinding = {
  session: LspWorkspaceSession
  model: Monaco.editor.ITextModel
  uri: string
  filePath: string
  worktreeId: string
  documentId?: WorkingDocumentId
  lspVersion: () => number
  dispose: () => void
}

const bindingsByModel = new Map<Monaco.editor.ITextModel, LspDocumentBinding>()
const bindingsBySessionUri = new Map<string, LspDocumentBinding>()
const bindingsByDocumentId = new Map<WorkingDocumentId, LspDocumentBinding>()
let didSaveBridgeInstalled = false

// The save queue announces every confirmed disk write; servers that re-read
// from disk (or gate features on save) get textDocument/didSave from it.
function installLspDidSaveBridge(): void {
  if (didSaveBridgeInstalled || typeof window === 'undefined') {
    return
  }
  didSaveBridgeInstalled = true
  window.addEventListener(ORCA_EDITOR_DOCUMENT_SAVED_EVENT, (event) => {
    const detail = (event as CustomEvent<EditorDocumentSavedDetail>).detail
    const binding = bindingsByDocumentId.get(detail.documentId)
    if (!binding) {
      return
    }
    notifyLsp(binding.session, 'textDocument/didSave', {
      textDocument: { uri: binding.uri },
      text: detail.content
    })
  })
}

function sessionUriKey(sessionId: string, uri: string): string {
  return `${sessionId}${uri}`
}

export function getLspBindingForModel(
  model: Monaco.editor.ITextModel
): LspDocumentBinding | undefined {
  return bindingsByModel.get(model)
}

export function getLspBindingForUri(
  sessionId: string,
  uri: string
): LspDocumentBinding | undefined {
  return bindingsBySessionUri.get(sessionUriKey(sessionId, uri))
}

// LSP languageIds are finer-grained than Monaco's for React dialects; tsserver
// picks the script kind (JSX parsing) from this.
export function lspLanguageIdForFile(filePath: string, monacoLanguageId: string): string {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.tsx')) {
    return 'typescriptreact'
  }
  if (lower.endsWith('.jsx')) {
    return 'javascriptreact'
  }
  if (monacoLanguageId === 'shell') {
    return 'shellscript'
  }
  return monacoLanguageId
}

/** Takes a session lease for the model's lifetime; repeated surfaces share the existing binding. */
export function ensureLspDocumentBinding(
  model: Monaco.editor.ITextModel,
  lease: LspSessionLease,
  filePath: string,
  monacoLanguageId: string,
  worktreeId: string,
  documentId?: WorkingDocumentId
): LspDocumentBinding {
  const existing = bindingsByModel.get(model)
  if (existing) {
    lease.release()
    return existing
  }
  const { session } = lease
  installLspDidSaveBridge()
  const uri = lspUriFromPath(filePath)
  const languageId = lspLanguageIdForFile(filePath, monacoLanguageId)
  // Own the version counter: a server restart resets the document, so the
  // model's internal version id (which keeps growing) can't be reused.
  let version = 1
  let epochSeen = session.epoch

  const sendDidOpen = (): void => {
    version = 1
    notifyLsp(session, 'textDocument/didOpen', {
      textDocument: { uri, languageId, version, text: model.getValue() }
    })
  }
  sendDidOpen()

  const contentSub = model.onDidChangeContent((event) => {
    version += 1
    notifyLsp(session, 'textDocument/didChange', {
      textDocument: { uri, version },
      // Monaco orders changes bottom-up in the pre-edit document, which is a
      // valid sequential application order for LSP incremental sync.
      contentChanges: event.changes.map((change) => ({
        range: toLspRange(change.range),
        rangeLength: change.rangeLength,
        text: change.text
      }))
    })
  })

  const statusSub = onLspSessionStatus(session, (current) => {
    // A restart re-initialized the server with no documents; replay this one.
    if (current.status === 'ready' && current.epoch !== epochSeen) {
      epochSeen = current.epoch
      sendDidOpen()
    }
  })

  const binding: LspDocumentBinding = {
    session,
    model,
    uri,
    filePath,
    worktreeId,
    documentId,
    lspVersion: () => version,
    dispose: () => {
      contentSub.dispose()
      statusSub()
      bindingsByModel.delete(model)
      bindingsBySessionUri.delete(sessionUriKey(session.sessionId, uri))
      if (documentId && bindingsByDocumentId.get(documentId) === binding) {
        bindingsByDocumentId.delete(documentId)
      }
      notifyLsp(session, 'textDocument/didClose', { textDocument: { uri } })
      lease.release()
    }
  }
  const disposeSub = model.onWillDispose(() => {
    disposeSub.dispose()
    binding.dispose()
  })
  bindingsByModel.set(model, binding)
  bindingsBySessionUri.set(sessionUriKey(session.sessionId, uri), binding)
  if (documentId) {
    bindingsByDocumentId.set(documentId, binding)
  }
  return binding
}
