import { getActiveTabNavOrder } from '@/components/tab-bar/group-tab-order'
import {
  ORCA_EDITOR_DOCUMENT_SAVED_EVENT,
  quiesceDocumentSave,
  requestEditorDocumentSave,
  type EditorDocumentSavedDetail
} from '@/components/editor/editor-autosave'
import { flushPendingEditorChange } from '@/components/editor/editor-pending-flush'
import { getConnectionIdForFile } from '@/lib/connection-context'
import { useAppStore } from '@/store'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'
import { getWorkingDocumentForFile } from '@renderer/store/slices/editor/working-document-state'
import type { OpenFile } from '@/store/slices/editor'
import { readRuntimeFileContent } from './runtime-file-client'
import { settingsForRuntimeOwner } from './runtime-rpc-client'
import {
  hashMarkdownContent,
  isMarkdownContentByteLengthOverLimit,
  MOBILE_MARKDOWN_EDIT_MAX_BYTES,
  type RuntimeMarkdownReadTabResult,
  type RuntimeMarkdownSaveTabResult,
  type RuntimeMobileMarkdownRequest,
  type RuntimeMobileMarkdownResponse
} from '../../../shared/mobile-markdown-document'

const MOBILE_MARKDOWN_READ_MAX_BYTES = 512 * 1024
const saveQueues = new Map<WorkingDocumentId, Promise<void>>()

type FileContent = {
  content: string
  isBinary: boolean
}

export function attachMobileMarkdownBridge(): () => void {
  if (typeof window.api.ui.onMobileMarkdownRequest !== 'function') {
    return () => {}
  }
  return window.api.ui.onMobileMarkdownRequest((request) => {
    void handleMobileMarkdownRequest(request)
  })
}

async function handleMobileMarkdownRequest(request: RuntimeMobileMarkdownRequest): Promise<void> {
  try {
    const result =
      request.operation === 'read'
        ? await readMobileMarkdownTab(request.worktreeId, request.tabId)
        : await saveMobileMarkdownTab(
            request.worktreeId,
            request.tabId,
            request.baseVersion,
            request.content
          )
    respond({ id: request.id, ok: true, result })
  } catch (error) {
    respond({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

async function readMobileMarkdownTab(
  worktreeId: string,
  tabId: string
): Promise<RuntimeMarkdownReadTabResult> {
  const target = resolveMarkdownTarget(worktreeId, tabId)
  flushPendingEditorChange(target.documentId)
  const { content, source } = await readCurrentContent(target.sourceFile, target.documentId)
  const readOnlyReason = getReadOnlyReason(target.tab, target.sourceFile, content)
  return {
    tabId,
    filePath: target.sourceFile.filePath,
    relativePath: target.sourceFile.relativePath,
    content,
    isDirty: target.sourceFile.isDirty || source === 'draft',
    version: hashMarkdownContent(content),
    source,
    editable: readOnlyReason === undefined,
    ...(readOnlyReason ? { readOnlyReason } : {})
  }
}

async function saveMobileMarkdownTab(
  worktreeId: string,
  tabId: string,
  baseVersion: string,
  content: string
): Promise<RuntimeMarkdownSaveTabResult> {
  if (isMarkdownContentByteLengthOverLimit(content, MOBILE_MARKDOWN_EDIT_MAX_BYTES)) {
    throw new Error('file_too_large')
  }
  const target = resolveMarkdownTarget(worktreeId, tabId)
  return await enqueueMarkdownSave(target.documentId, async () => {
    const freshTarget = resolveMarkdownTarget(worktreeId, tabId)
    const readOnlyReason = getReadOnlyReason(freshTarget.tab, freshTarget.sourceFile, content)
    if (readOnlyReason) {
      throw new Error(readOnlyReason)
    }

    flushPendingEditorChange(freshTarget.documentId)
    const current = await readCurrentContent(freshTarget.sourceFile, freshTarget.documentId)
    const currentVersion = hashMarkdownContent(current.content)
    if (currentVersion !== baseVersion) {
      if (current.content === content) {
        // Why: duplicate mobile save taps can race behind the first successful
        // write; treat an already-saved identical file as success, not conflict.
        return {
          tabId,
          version: currentVersion,
          isDirty: false,
          content: current.content
        }
      }
      throw new Error('conflict')
    }

    const state = useAppStore.getState()
    state.setWorkingDocumentContent(freshTarget.documentId, content)
    await waitForPositiveSave(freshTarget.documentId, content)
    const verified = await readFileContent(freshTarget.sourceFile)
    if (verified !== content) {
      throw new Error('save_verification_failed')
    }

    return {
      tabId,
      version: hashMarkdownContent(verified),
      isDirty: false,
      content: verified
    }
  })
}

function enqueueMarkdownSave<T>(documentId: WorkingDocumentId, save: () => Promise<T>): Promise<T> {
  const previous = saveQueues.get(documentId) ?? Promise.resolve()
  let releaseQueue: () => void = () => {}
  const current = new Promise<void>((resolve) => {
    releaseQueue = resolve
  })
  const queued = previous.catch(() => undefined).then(() => current)
  saveQueues.set(documentId, queued)
  return previous
    .catch(() => undefined)
    .then(save)
    .finally(() => {
      releaseQueue()
      if (saveQueues.get(documentId) === queued) {
        saveQueues.delete(documentId)
      }
    })
}

// Mobile writes are serialized independently so duplicate mobile requests do
// not race their optimistic version checks before they join the document queue.

function resolveMarkdownTarget(
  worktreeId: string,
  tabId: string
): { tab: OpenFile; sourceFile: OpenFile; documentId: WorkingDocumentId } {
  const state = useAppStore.getState()
  const orderItem = getActiveTabNavOrder(state, worktreeId).find(
    (item) => item.type === 'editor' && (item.tabId === tabId || item.id === tabId)
  )
  const tabFileId = orderItem?.type === 'editor' ? orderItem.id : tabId
  const tab = state.openFiles.find(
    (file) => file.worktreeId === worktreeId && (file.id === tabFileId || file.id === tabId)
  )
  if (!tab || !isMarkdownTab(tab)) {
    throw new Error('tab_not_found')
  }
  const sourceFile =
    tab.mode === 'markdown-preview' && tab.markdownPreviewSourceFileId
      ? (state.openFiles.find(
          (file) => file.worktreeId === worktreeId && file.id === tab.markdownPreviewSourceFileId
        ) ?? tab)
      : tab
  const document = getWorkingDocumentForFile(state, sourceFile.id)
  if (!document) {
    throw new Error('document_not_ready')
  }
  return { tab, sourceFile, documentId: document.id }
}

function isMarkdownTab(file: OpenFile): boolean {
  if (file.mode !== 'edit' && file.mode !== 'markdown-preview') {
    return false
  }
  return file.language === 'markdown' || file.mode === 'markdown-preview'
}

function getReadOnlyReason(
  tab: OpenFile,
  sourceFile: OpenFile,
  content: string
): RuntimeMarkdownReadTabResult['readOnlyReason'] {
  if (tab.mode === 'markdown-preview') {
    return 'unsupported_preview'
  }
  if (sourceFile.isUntitled) {
    return 'unsupported_untitled'
  }
  if (isMarkdownContentByteLengthOverLimit(content, MOBILE_MARKDOWN_EDIT_MAX_BYTES)) {
    return 'file_too_large'
  }
  return undefined
}

async function readCurrentContent(
  file: OpenFile,
  documentId: WorkingDocumentId
): Promise<{ content: string; source: 'draft' | 'file' }> {
  const document = useAppStore.getState().workingDocuments[documentId]
  if (document?.content !== undefined) {
    return { content: document.content, source: document.isDirty ? 'draft' : 'file' }
  }
  return { content: await readFileContent(file), source: 'file' }
}

async function readFileContent(file: OpenFile): Promise<string> {
  const connectionId = getConnectionIdForFile(file.worktreeId, file.filePath) ?? undefined
  const state = useAppStore.getState()
  const result = (await readRuntimeFileContent({
    settings: settingsForRuntimeOwner(state.settings, file.runtimeEnvironmentId),
    filePath: file.filePath,
    relativePath: file.relativePath,
    worktreeId: file.worktreeId,
    connectionId,
    expectedExternalSshTargetId: file.externalSshTargetId
  })) as FileContent
  if (result.isBinary) {
    throw new Error('binary_file')
  }
  if (isMarkdownContentByteLengthOverLimit(result.content, MOBILE_MARKDOWN_READ_MAX_BYTES)) {
    throw new Error('file_too_large')
  }
  return result.content
}

async function waitForPositiveSave(documentId: WorkingDocumentId, content: string): Promise<void> {
  let timeout: number | null = null
  let onSaved: ((event: Event) => void) | null = null
  const cleanup = (): void => {
    if (timeout !== null) {
      window.clearTimeout(timeout)
      timeout = null
    }
    if (onSaved) {
      window.removeEventListener(ORCA_EDITOR_DOCUMENT_SAVED_EVENT, onSaved as EventListener)
      onSaved = null
    }
  }
  const saved = new Promise<void>((resolve, reject) => {
    timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error('save_timeout'))
    }, 20_000)
    onSaved = (event: Event): void => {
      const detail = (event as CustomEvent<EditorDocumentSavedDetail>).detail
      if (detail?.documentId !== documentId || detail.content !== content) {
        return
      }
      cleanup()
      resolve()
    }
    window.addEventListener(ORCA_EDITOR_DOCUMENT_SAVED_EVENT, onSaved as EventListener)
  })

  try {
    await quiesceDocumentSave(documentId)
    await requestEditorDocumentSave({ documentId })
    await saved
  } catch (error) {
    cleanup()
    throw error
  }
}

function respond(response: RuntimeMobileMarkdownResponse): void {
  window.api.ui.respondMobileMarkdownRequest(response)
}
