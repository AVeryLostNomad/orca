import { useEffect, useRef } from 'react'
import type { editor, IRange } from 'monaco-editor'
import {
  isComparisonCancellationError,
  requestComparison
} from '@/lib/diff-comparison/comparison-client'
import type { SerializedLineChange } from '@/lib/diff-comparison/comparison-types'
import { getLargeDiffRenderLimit } from './large-diff-render-limit'
import type { EditorGitBaseline } from './editor-git-baseline'
import { getMonacoModelSnapshot } from '@/lib/monaco-model-snapshot'
import { getDeletedLineAnchor, getGitHunkKind } from './git-gutter-hunks'
import { GitHunkPeekController, type GitHunkSnapshot } from './git-hunk-peek-controller'

type MonacoGitGutterOptions = {
  baseline: EditorGitBaseline | null
  language: string
  showWhitespace: boolean
}

// Coalesces keystroke bursts; existing marks track edits meanwhile, so nothing blinks.
const CONTENT_REFRESH_DELAY_MS = 120
// NeverGrowsWhenTypingAtEdges: while a recompute is pending, text typed at a
// mark's edge (notably a zero-width deletion) must not stretch the mark over it.
const GUTTER_STICKINESS = 1

function lineRange(
  model: editor.ITextModel,
  startLineNumber: number,
  endLineNumberExclusive: number
): IRange | null {
  const lastLineNumber = endLineNumberExclusive - 1
  if (
    startLineNumber < 1 ||
    lastLineNumber < startLineNumber ||
    lastLineNumber > model.getLineCount()
  ) {
    return null
  }

  return {
    startLineNumber,
    startColumn: 1,
    endLineNumber: lastLineNumber,
    endColumn: model.getLineMaxColumn(lastLineNumber)
  }
}

const GUTTER_CLASS_BY_KIND = {
  added: 'orca-git-gutter-added',
  modified: 'orca-git-gutter-modified'
} as const

/**
 * Converts the shared half-open line ranges into an editor-owned decoration
 * lane. The collection is deliberately separate from conflicts/comments so a
 * refresh cannot replace their decorations.
 */
export function buildMonacoGitGutterDecorations(
  model: editor.ITextModel,
  changes: readonly SerializedLineChange[],
  originalContent: string
): editor.IModelDeltaDecoration[] {
  const decorations: editor.IModelDeltaDecoration[] = []

  for (const change of changes) {
    const kind = getGitHunkKind(change, originalContent, model)
    if (kind === 'deleted') {
      const deleted = getDeletedLineAnchor(model, change.modifiedStartLineNumber)
      decorations.push({
        range: deleted.range,
        options: {
          linesDecorationsClassName: `orca-git-gutter-deleted orca-git-gutter-deleted-${deleted.side}`,
          stickiness: GUTTER_STICKINESS
        }
      })
    } else if (kind) {
      const range = lineRange(
        model,
        change.modifiedStartLineNumber,
        change.modifiedEndLineNumberExclusive
      )
      if (range) {
        decorations.push({
          range,
          options: {
            linesDecorationsClassName: GUTTER_CLASS_BY_KIND[kind],
            stickiness: GUTTER_STICKINESS
          }
        })
      }
    }
  }

  return decorations
}

type AppliedGitChanges = GitHunkSnapshot & { version: number }

export class MonacoGitGutterController {
  private collection: editor.IEditorDecorationsCollection | null = null
  private model: editor.ITextModel | null = null
  private modelContentSubscription: { dispose(): void } | null = null
  private modelLanguageSubscription: { dispose(): void } | null = null
  private modelSubscription: { dispose(): void } | null = null
  private requestController: AbortController | null = null
  private requestGeneration = 0
  private refreshTimer: number | null = null
  private applied: AppliedGitChanges | null = null
  private disposed = false

  constructor(
    private readonly mountedEditor: editor.IStandaloneCodeEditor,
    private options: MonacoGitGutterOptions,
    private readonly onMarksChanged?: () => void
  ) {}

  /** Changes behind the visible marks, only while they still describe the model's current text. */
  getSnapshot(): GitHunkSnapshot | null {
    const applied = this.applied
    if (
      !applied ||
      applied.model !== this.model ||
      applied.model.isDisposed() ||
      applied.model.getAlternativeVersionId() !== applied.version
    ) {
      return null
    }
    return applied
  }

  start(): void {
    if (this.disposed) {
      return
    }
    this.modelSubscription = this.mountedEditor.onDidChangeModel(() => {
      this.attachCurrentModel()
      this.refresh()
    })
    this.attachCurrentModel()
    this.refresh()
  }

  update(options: MonacoGitGutterOptions): void {
    if (this.disposed) {
      return
    }
    if (
      this.options.baseline?.content === options.baseline?.content &&
      this.options.baseline?.identity === options.baseline?.identity &&
      this.options.baseline?.version === options.baseline?.version &&
      this.options.language === options.language &&
      this.options.showWhitespace === options.showWhitespace
    ) {
      return
    }

    // A different owner or no baseline makes current marks untrustworthy; a new
    // version of the same baseline only needs recomputing.
    const baselineReplaced =
      !options.baseline || options.baseline.identity !== this.options.baseline?.identity
    this.options = options
    this.refresh({ clear: baselineReplaced })
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.requestGeneration += 1
    this.cancelScheduledRefresh()
    this.requestController?.abort()
    this.requestController = null
    this.modelContentSubscription?.dispose()
    this.modelContentSubscription = null
    this.modelLanguageSubscription?.dispose()
    this.modelLanguageSubscription = null
    this.modelSubscription?.dispose()
    this.modelSubscription = null
    this.clearMarks()
    this.collection = null
    this.model = null
  }

  private attachCurrentModel(): void {
    const nextModel = this.mountedEditor.getModel()
    if (nextModel === this.model) {
      return
    }

    this.requestGeneration += 1
    this.cancelScheduledRefresh()
    this.requestController?.abort()
    this.requestController = null
    this.modelContentSubscription?.dispose()
    this.modelContentSubscription = null
    this.modelLanguageSubscription?.dispose()
    this.modelLanguageSubscription = null
    this.clearMarks()
    this.model = nextModel
    if (!nextModel) {
      return
    }

    this.modelContentSubscription = nextModel.onDidChangeContent(() => this.scheduleRefresh())
    this.modelLanguageSubscription = nextModel.onDidChangeLanguage(() => this.refresh())
  }

  private scheduleRefresh(): void {
    this.cancelScheduledRefresh()
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null
      this.refresh({ clear: false })
    }, CONTENT_REFRESH_DELAY_MS)
  }

  private cancelScheduledRefresh(): void {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
  }

  private clearMarks(): void {
    this.collection?.clear()
    if (this.applied) {
      this.applied = null
      this.onMarksChanged?.()
    }
  }

  private apply(
    model: editor.ITextModel,
    changes: readonly SerializedLineChange[],
    language: string
  ): void {
    const originalContent = this.options.baseline?.content ?? ''
    const decorations = buildMonacoGitGutterDecorations(model, changes, originalContent)
    if (!this.collection) {
      this.collection = this.mountedEditor.createDecorationsCollection(decorations)
    } else {
      this.collection.set(decorations)
    }
    this.applied = {
      model,
      changes,
      originalContent,
      language,
      version: model.getAlternativeVersionId()
    }
    this.onMarksChanged?.()
  }

  private refresh({ clear }: { clear: boolean } = { clear: true }): void {
    if (this.disposed) {
      return
    }
    this.cancelScheduledRefresh()
    this.attachCurrentModel()
    const model = this.model
    const { baseline, showWhitespace } = this.options
    const generation = ++this.requestGeneration
    this.requestController?.abort()
    this.requestController = null
    if (clear) {
      this.clearMarks()
    }

    if (!model || model.isDisposed() || !baseline) {
      this.clearMarks()
      return
    }
    const source = getMonacoModelSnapshot(model)
    const { content: modifiedContent, language } = source
    if (getLargeDiffRenderLimit({ originalContent: baseline.content, modifiedContent }).limited) {
      this.clearMarks()
      return
    }

    const originalIdentity = baseline.identity
    const originalVersion = baseline.version
    const modifiedIdentity = source.identity
    const modifiedVersion = source.alternativeVersion
    const controller = new AbortController()
    this.requestController = controller

    void requestComparison(
      {
        output: 'monaco',
        originalContent: baseline.content,
        modifiedContent,
        language,
        showWhitespace,
        originalVersion,
        modifiedVersion,
        originalIdentity,
        modifiedIdentity
      },
      { signal: controller.signal }
    )
      .then((result) => {
        if (
          this.disposed ||
          generation !== this.requestGeneration ||
          controller.signal.aborted ||
          this.model !== model ||
          model.isDisposed() ||
          model.getAlternativeVersionId() !== modifiedVersion ||
          this.options.baseline?.identity !== originalIdentity ||
          this.options.baseline?.version !== originalVersion ||
          this.options.baseline?.content !== baseline.content ||
          model.getLanguageId() !== language ||
          this.options.showWhitespace !== showWhitespace ||
          result.output !== 'monaco' ||
          result.originalVersion !== originalVersion ||
          result.modifiedVersion !== modifiedVersion ||
          result.quitEarly
        ) {
          return
        }

        this.apply(model, result.changes, language)
      })
      .catch((error: unknown) => {
        if (
          this.disposed ||
          generation !== this.requestGeneration ||
          controller.signal.aborted ||
          isComparisonCancellationError(error)
        ) {
          return
        }
        this.clearMarks()
      })
  }
}

export function useMonacoGitGutter({
  mountedEditor,
  baseline,
  language,
  showWhitespace,
  filePath
}: {
  mountedEditor: editor.IStandaloneCodeEditor | null
  baseline: EditorGitBaseline | null
  language: string
  showWhitespace: boolean
  filePath: string
}): void {
  const controllerRef = useRef<MonacoGitGutterController | null>(null)
  const optionsRef = useRef({ baseline, language, showWhitespace })
  optionsRef.current = { baseline, language, showWhitespace }
  const filePathRef = useRef(filePath)
  filePathRef.current = filePath

  useEffect(() => {
    if (!mountedEditor) {
      return
    }
    let peek: GitHunkPeekController | null = null
    const controller = new MonacoGitGutterController(mountedEditor, optionsRef.current, () =>
      peek?.refresh()
    )
    peek = new GitHunkPeekController(
      mountedEditor,
      () => controller.getSnapshot(),
      () => filePathRef.current
    )
    controllerRef.current = controller
    controller.start()
    return () => {
      peek?.dispose()
      controller.dispose()
      if (controllerRef.current === controller) {
        controllerRef.current = null
      }
    }
  }, [mountedEditor])

  useEffect(() => {
    controllerRef.current?.update({ baseline, language, showWhitespace })
  }, [baseline, language, showWhitespace])
}
