import { Emitter } from 'monaco-editor/esm/vs/base/common/event.js'
import { CancellationError } from 'monaco-editor/esm/vs/base/common/errors.js'
import { LineRange } from 'monaco-editor/esm/vs/editor/common/core/ranges/lineRange.js'
import { Range } from 'monaco-editor/esm/vs/editor/common/core/range.js'
import {
  DetailedLineRangeMapping,
  RangeMapping
} from 'monaco-editor/esm/vs/editor/common/diff/rangeMapping.js'
import 'monaco-editor/esm/vs/editor/browser/widget/diffEditor/diffProviderFactoryService.js'
import { SyncDescriptor } from 'monaco-editor/esm/vs/platform/instantiation/common/descriptors.js'
import { StandaloneServices } from 'monaco-editor/esm/vs/editor/standalone/browser/standaloneServices.js'
import {
  getComparisonRequestKey,
  isComparisonCancellationError,
  requestComparison,
  subscribeComparisonFailures
} from './comparison-client'
import type { ComparisonInput, SerializedLineChange, SerializedRange } from './comparison-types'
import { useAppStore } from '@/store'
import { getMonacoModelSnapshot, type SnapshotTextModel } from '../monaco-model-snapshot'

type MonacoTextModel = SnapshotTextModel & {
  isDisposed(): boolean
  onDidChangeLanguage(listener: () => void): { dispose(): void }
}

type MonacoCancellationToken = {
  isCancellationRequested: boolean
  onCancellationRequested?: (listener: () => void) => { dispose(): void }
}

type DiffProviderResult = {
  changes: DetailedLineRangeMapping[]
  identical: boolean
  quitEarly: boolean
  moves: []
}

type DiffProvider = {
  readonly onDidChange: (listener: () => void) => { dispose(): void }
  computeDiff(
    original: MonacoTextModel,
    modified: MonacoTextModel,
    options: unknown,
    cancellationToken: MonacoCancellationToken
  ): Promise<DiffProviderResult>
  dispose(): void
}

const providers = new Set<MonacoComparisonProvider>()
let showWhitespace = false
let hasWhitespacePreferenceSubscription = false

function notifyMatchingProviders(key: string): void {
  for (const provider of providers) {
    if (provider.requestKey === key) {
      provider.notifyChanged()
    }
  }
}

function ensurePreferenceSubscription(): void {
  if (hasWhitespacePreferenceSubscription) {
    return
  }
  hasWhitespacePreferenceSubscription = true
  showWhitespace = useAppStore.getState().settings?.diffShowWhitespace === true
  useAppStore.subscribe((state, previousState) => {
    const next = state.settings?.diffShowWhitespace === true
    const previous = previousState.settings?.diffShowWhitespace === true
    if (next === previous) {
      return
    }
    showWhitespace = next
    for (const provider of providers) {
      provider.notifyChanged()
    }
  })
  subscribeComparisonFailures((key, error) => {
    if (error === null) {
      notifyMatchingProviders(key)
    }
  })
}

function toRange(range: SerializedRange): Range {
  return new Range(range[0], range[1], range[2], range[3])
}

function toDetailedMapping(change: SerializedLineChange): DetailedLineRangeMapping {
  const innerChanges = change.innerChanges?.map(
    (inner) => new RangeMapping(toRange(inner.originalRange), toRange(inner.modifiedRange))
  )
  return new DetailedLineRangeMapping(
    new LineRange(change.originalStartLineNumber, change.originalEndLineNumberExclusive),
    new LineRange(change.modifiedStartLineNumber, change.modifiedEndLineNumberExclusive),
    innerChanges
  )
}

function buildInput(original: MonacoTextModel, modified: MonacoTextModel): ComparisonInput {
  const originalSource = getMonacoModelSnapshot(original)
  const modifiedSource = getMonacoModelSnapshot(modified)
  return {
    output: 'monaco',
    originalContent: originalSource.content,
    modifiedContent: modifiedSource.content,
    language: modifiedSource.language,
    showWhitespace,
    originalVersion: originalSource.alternativeVersion,
    modifiedVersion: modifiedSource.alternativeVersion,
    originalIdentity: originalSource.identity,
    modifiedIdentity: modifiedSource.identity
  }
}

class MonacoComparisonProvider implements DiffProvider {
  private readonly emitter = new Emitter<void>()
  private requestGeneration = 0
  private controller: AbortController | null = null
  private disposed = false
  private lifetimeCancellation: { dispose(): void } | null = null
  private languageSubscription: { dispose(): void } | null = null
  private observedModified: MonacoTextModel | null = null
  requestKey: string | null = null

  readonly onDidChange = this.emitter.event

  constructor() {
    ensurePreferenceSubscription()
    providers.add(this)
  }

  notifyChanged(): void {
    this.emitter.fire()
  }

  async computeDiff(
    original: MonacoTextModel,
    modified: MonacoTextModel,
    _options: unknown,
    cancellationToken: MonacoCancellationToken
  ): Promise<DiffProviderResult> {
    if (
      this.disposed ||
      original.isDisposed() ||
      modified.isDisposed() ||
      cancellationToken.isCancellationRequested
    ) {
      this.dispose()
      throw new CancellationError()
    }
    // Monaco 0.55.1 cancels the view-model token but does not dispose its provider.
    this.lifetimeCancellation ??=
      cancellationToken.onCancellationRequested?.(() => this.dispose()) ?? null
    if (this.observedModified !== modified) {
      this.languageSubscription?.dispose()
      this.observedModified = modified
      this.languageSubscription = modified.onDidChangeLanguage(() => this.notifyChanged())
    }
    const input = buildInput(original, modified)
    const key = getComparisonRequestKey(input)
    const generation = ++this.requestGeneration
    this.requestKey = key
    this.controller?.abort()
    const controller = new AbortController()
    this.controller = controller
    try {
      const result = await requestComparison(input, { signal: controller.signal })
      if (
        cancellationToken.isCancellationRequested ||
        this.disposed ||
        original.isDisposed() ||
        modified.isDisposed() ||
        generation !== this.requestGeneration ||
        input.originalVersion !== original.getAlternativeVersionId() ||
        input.modifiedVersion !== modified.getAlternativeVersionId() ||
        input.language !== modified.getLanguageId() ||
        input.showWhitespace !== showWhitespace
      ) {
        throw new CancellationError()
      }
      if (result.output !== 'monaco') {
        throw new Error('Diff comparison worker returned an incompatible result.')
      }
      return {
        changes: result.changes.map(toDetailedMapping),
        identical: result.identical,
        quitEarly: result.quitEarly,
        moves: []
      }
    } catch (error) {
      if (isComparisonCancellationError(error) || cancellationToken.isCancellationRequested) {
        throw new CancellationError()
      }
      throw error
    }
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.requestGeneration += 1
    this.controller?.abort()
    this.lifetimeCancellation?.dispose()
    this.languageSubscription?.dispose()
    this.observedModified = null
    providers.delete(this)
    this.emitter.dispose()
  }
}

class MonacoComparisonProviderFactory {
  createDiffProvider(_options: { diffAlgorithm?: unknown }): DiffProvider {
    return new MonacoComparisonProvider()
  }
}

/**
 * Must run before any standalone editor initializes services. The imported
 * Monaco classes are intentionally quarantined here because they are internal
 * to the pinned Monaco 0.55.1 structure.
 */
export function installMonacoDiffProviderFactory(): void {
  StandaloneServices.initialize({
    diffProviderFactoryService: new SyncDescriptor(MonacoComparisonProviderFactory)
  })
}
