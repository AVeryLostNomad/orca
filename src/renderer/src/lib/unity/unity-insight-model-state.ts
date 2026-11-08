import type * as Monaco from 'monaco-editor'
import type { UnityProjectInfo } from '../../../../shared/unity-types'
import { lspBindingFor } from '@/lib/lsp/lsp-provider-binding-access'
import { parseCSharpOutline } from './csharp-syntax-outline'
import type { CSharpOutline, CSharpTypeDeclaration } from './csharp-syntax-outline-types'
import { resolveUnityClassKind } from './unity-class-context'
import { createUnityClassResolver } from './unity-class-resolver'
import type { UnityBaseKind } from './unity-event-function-types'
import { analyzeUnityDocument, type UnityInsightAnalysis } from './unity-insight-analysis'
import { applyUnityInsightMarkers, clearUnityInsightMarkers } from './unity-insight-markers'

type MonacoModule = typeof Monaco

export type UnityModelInsight = {
  model: Monaco.editor.ITextModel
  filePath: string
  worktreeId: string
  /** Local workspace root the file lives in, for opening related assets as tabs. */
  workspaceRoot: string | null
  project: UnityProjectInfo
  analysis: UnityInsightAnalysis | null
}

type KindEntry = { kind: UnityBaseKind | null; incomplete: boolean; viaServer: boolean }

type InsightEntry = UnityModelInsight & {
  references: number
  outline: { version: number; outline: CSharpOutline } | null
  kinds: Map<string, KindEntry>
  decorationIds: string[]
  timer: number | null
  retryTimer: number | null
  retries: number
  running: boolean
  dirty: boolean
  projectFetchedAt: number
  disposables: Monaco.IDisposable[]
}

const ANALYSIS_DEBOUNCE_MS = 350
const UNRESOLVED_RETRY_MS = 4000
const MAX_UNRESOLVED_RETRIES = 15
const PROJECT_INFO_STALE_MS = 15_000

const entries = new Map<Monaco.editor.ITextModel, InsightEntry>()
const changeListeners = new Set<(model: Monaco.editor.ITextModel) => void>()

export function unityInsightForModel(
  model: Monaco.editor.ITextModel
): UnityModelInsight | undefined {
  return entries.get(model)
}

export function onUnityInsightChanged(
  listener: (model: Monaco.editor.ITextModel) => void
): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}

/** Outline of the model's current text (cached per model version). */
export function unityOutlineForModel(model: Monaco.editor.ITextModel): CSharpOutline | null {
  const entry = entries.get(model)
  if (!entry) {
    return null
  }
  const version = model.getVersionId()
  if (entry.outline?.version !== version) {
    entry.outline = { version, outline: parseCSharpOutline(model.getValue()) }
  }
  return entry.outline.outline
}

function kindKey(type: CSharpTypeDeclaration): string {
  const containers: string[] = []
  for (let current = type.containingType; current; current = current.containingType) {
    containers.unshift(current.name)
  }
  return [
    type.namespace ?? '',
    ...containers,
    type.name,
    type.kind,
    type.baseTypes[0]?.text ?? ''
  ].join('|')
}

/** Resolved Unity base kinds of the outline's types, from the last resolution pass. */
export function unityTypeKindsForModel(
  model: Monaco.editor.ITextModel,
  outline: CSharpOutline
): Map<CSharpTypeDeclaration, UnityBaseKind> {
  const kinds = new Map<CSharpTypeDeclaration, UnityBaseKind>()
  const entry = entries.get(model)
  for (const type of outline.types) {
    const kind = entry?.kinds.get(kindKey(type))?.kind
    if (kind) {
      kinds.set(type, kind)
    }
  }
  return kinds
}

async function resolveKinds(
  monaco: MonacoModule,
  entry: InsightEntry,
  outline: CSharpOutline
): Promise<boolean> {
  const binding = lspBindingFor(entry.model)
  const resolver = createUnityClassResolver(
    monaco,
    binding?.session,
    binding ? { filePath: binding.filePath, uri: binding.uri } : null
  )
  const viaServer = resolver.qualifiedBaseName !== undefined
  let unresolved = false
  const live = new Set<string>()
  for (const type of outline.types) {
    const key = kindKey(type)
    live.add(key)
    const cached = entry.kinds.get(key)
    if (cached && (!cached.incomplete || cached.viaServer === viaServer)) {
      unresolved ||= cached.incomplete && !viaServer
      continue
    }
    const resolution = await resolveUnityClassKind(
      { type, outline, filePath: entry.filePath },
      resolver
    )
    entry.kinds.set(key, { ...resolution, viaServer })
    unresolved ||= resolution.incomplete && !viaServer
  }
  for (const key of entry.kinds.keys()) {
    if (!live.has(key)) {
      entry.kinds.delete(key)
    }
  }
  return unresolved
}

async function refreshProjectInfo(entry: InsightEntry): Promise<void> {
  if (Date.now() - entry.projectFetchedAt < PROJECT_INFO_STALE_MS) {
    return
  }
  entry.projectFetchedAt = Date.now()
  const project = await window.api?.unity
    ?.getProjectInfo({ path: entry.filePath })
    .catch(() => null)
  if (project) {
    entry.project = project
  }
}

async function runAnalysis(monaco: MonacoModule, entry: InsightEntry): Promise<void> {
  if (entry.running) {
    entry.dirty = true
    return
  }
  entry.running = true
  try {
    do {
      entry.dirty = false
      const { model } = entry
      if (model.isDisposed() || entries.get(model) !== entry) {
        return
      }
      const version = model.getVersionId()
      const outline = unityOutlineForModel(model)
      if (!outline) {
        return
      }
      await refreshProjectInfo(entry)
      const unresolved = await resolveKinds(monaco, entry, outline)
      if (model.isDisposed() || entries.get(model) !== entry) {
        return
      }
      if (model.getVersionId() !== version) {
        entry.dirty = true
        continue
      }
      entry.analysis = analyzeUnityDocument({
        outline,
        typeKinds: unityTypeKindsForModel(model, outline),
        project: entry.project,
        scriptName: entry.filePath.replace(/^.*[\\/]/, '').replace(/\.cs$/i, '')
      })
      entry.decorationIds = applyUnityInsightMarkers(
        monaco,
        model,
        entry.analysis,
        entry.decorationIds
      )
      for (const listener of changeListeners) {
        listener(model)
      }
      scheduleRetry(monaco, entry, unresolved)
    } while (entry.dirty)
  } finally {
    entry.running = false
  }
}

// The language server may attach (or finish loading projects) after the first pass.
function scheduleRetry(monaco: MonacoModule, entry: InsightEntry, unresolved: boolean): void {
  if (entry.retryTimer !== null) {
    window.clearTimeout(entry.retryTimer)
    entry.retryTimer = null
  }
  if (!unresolved || entry.retries >= MAX_UNRESOLVED_RETRIES) {
    return
  }
  entry.retries++
  entry.retryTimer = window.setTimeout(() => {
    entry.retryTimer = null
    void runAnalysis(monaco, entry)
  }, UNRESOLVED_RETRY_MS)
}

function scheduleAnalysis(monaco: MonacoModule, entry: InsightEntry): void {
  if (entry.timer !== null) {
    window.clearTimeout(entry.timer)
  }
  entry.timer = window.setTimeout(() => {
    entry.timer = null
    void runAnalysis(monaco, entry)
  }, ANALYSIS_DEBOUNCE_MS)
}

function disposeEntry(monaco: MonacoModule, entry: InsightEntry): void {
  entries.delete(entry.model)
  if (entry.timer !== null) {
    window.clearTimeout(entry.timer)
  }
  if (entry.retryTimer !== null) {
    window.clearTimeout(entry.retryTimer)
  }
  for (const disposable of entry.disposables) {
    disposable.dispose()
  }
  if (!entry.model.isDisposed()) {
    clearUnityInsightMarkers(monaco, entry.model, entry.decorationIds)
  }
  for (const listener of changeListeners) {
    listener(entry.model)
  }
}

/** Start Unity insight for a model (shared by every editor showing it). Returns a release. */
export function attachUnityModelInsight(
  monaco: MonacoModule,
  model: Monaco.editor.ITextModel,
  init: Pick<UnityModelInsight, 'filePath' | 'worktreeId' | 'workspaceRoot' | 'project'>
): () => void {
  let entry = entries.get(model)
  if (entry) {
    entry.references++
    Object.assign(entry, init)
  } else {
    const created: InsightEntry = {
      model,
      ...init,
      analysis: null,
      references: 1,
      outline: null,
      kinds: new Map(),
      decorationIds: [],
      timer: null,
      retryTimer: null,
      retries: 0,
      running: false,
      dirty: false,
      projectFetchedAt: Date.now(),
      disposables: []
    }
    created.disposables.push(
      model.onDidChangeContent(() => scheduleAnalysis(monaco, created)),
      model.onWillDispose(() => disposeEntry(monaco, created))
    )
    entries.set(model, created)
    entry = created
    void runAnalysis(monaco, created)
  }
  const attached = entry
  let released = false
  return () => {
    if (released) {
      return
    }
    released = true
    attached.references--
    if (attached.references <= 0 && entries.get(model) === attached) {
      disposeEntry(monaco, attached)
    }
  }
}
