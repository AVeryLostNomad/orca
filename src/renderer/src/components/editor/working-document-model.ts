import type { editor, IDisposable, Uri } from 'monaco-editor'
import { monaco } from '@/lib/monaco-setup'
import { useAppStore } from '@/store'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'
import { syncTextModelContent } from './monaco-content-sync'
import {
  beginProgrammaticContentSync,
  endProgrammaticContentSync,
  isProgrammaticContentSyncInFlight
} from './monaco-programmatic-sync'
import {
  isWorkingDocumentSavePending,
  subscribeWorkingDocumentSaveSettled
} from './editor-save-queue'
import { getMonacoModelSnapshot } from '@/lib/monaco-model-snapshot'

type RetainedModel = {
  model: editor.ITextModel
  surfaces: Map<string, symbol>
  subscription: IDisposable
  revision: number
}

const models = new Map<WorkingDocumentId, RetainedModel>()
let unsubscribeStore: (() => void) | undefined
let unsubscribeSaves: (() => void) | undefined

// Why: peek/reference UIs label models by URI path, so carry the file path; the id query keeps it unique.
function workingDocumentModelUri(id: WorkingDocumentId, filePath: string): Uri {
  return monaco.Uri.from({
    scheme: 'orca-working-document',
    path: monaco.Uri.file(filePath).path,
    query: id
  })
}

function collectModel(id: WorkingDocumentId, entry: RetainedModel): void {
  const state = useAppStore.getState()
  const document = state.workingDocuments[id]
  if (entry.surfaces.size || document?.isDirty || isWorkingDocumentSavePending(id)) {
    return
  }
  if (Object.values(state.workingDocumentIdsByTab).some((ids) => ids.includes(id))) {
    return
  }
  entry.subscription.dispose()
  entry.model.dispose()
  models.delete(id)
  if (!models.size) {
    unsubscribeStore?.()
    unsubscribeStore = undefined
    unsubscribeSaves?.()
    unsubscribeSaves = undefined
  }
}

function synchronizeModels(): void {
  const state = useAppStore.getState()
  for (const [id, entry] of models) {
    const document = state.workingDocuments[id]
    if (document && document.revision !== entry.revision && document.content !== undefined) {
      entry.revision = document.revision
      beginProgrammaticContentSync(id)
      try {
        syncTextModelContent(entry.model, document.content)
        if (entry.model.getLanguageId() !== document.target.language) {
          monaco.editor.setModelLanguage(entry.model, document.target.language)
        }
      } finally {
        endProgrammaticContentSync(id)
      }
    }
    collectModel(id, entry)
  }
}

export function acquireWorkingDocumentModel(id: WorkingDocumentId): editor.ITextModel {
  const existing = models.get(id)
  if (existing) {
    return existing.model
  }
  const document = useAppStore.getState().workingDocuments[id]
  if (!document || document.loadState !== 'ready' || document.content === undefined) {
    throw new Error('The working document is not loaded.')
  }
  const model = monaco.editor.createModel(
    document.content,
    document.target.language,
    workingDocumentModelUri(id, document.target.filePath)
  )
  const entry: RetainedModel = {
    model,
    surfaces: new Map(),
    revision: document.revision,
    subscription: model.onDidChangeContent(() => {
      if (isProgrammaticContentSyncInFlight(id)) {
        return
      }
      const state = useAppStore.getState()
      const current = state.workingDocuments[id]
      if (!current || !current.writable || current.loadState !== 'ready') {
        return
      }
      const content = getMonacoModelSnapshot(model).content
      if (content === current.content) {
        return
      }
      entry.revision = current.revision + 1
      state.setWorkingDocumentContent(id, content)
    })
  }
  models.set(id, entry)
  if (!unsubscribeStore) {
    unsubscribeStore = useAppStore.subscribe(synchronizeModels)
  }
  if (!unsubscribeSaves) {
    unsubscribeSaves = subscribeWorkingDocumentSaveSettled((savedId) => {
      const savedModel = models.get(savedId)
      if (savedModel) {
        collectModel(savedId, savedModel)
      }
    })
  }
  return model
}

export function attachWorkingDocumentEditor(id: WorkingDocumentId, surfaceId: string): () => void {
  acquireWorkingDocumentModel(id)
  const entry = models.get(id)!
  const token = Symbol(surfaceId)
  entry.surfaces.set(surfaceId, token)
  return () => {
    if (entry.surfaces.get(surfaceId) !== token) {
      return
    }
    entry.surfaces.delete(surfaceId)
    collectModel(id, entry)
  }
}
