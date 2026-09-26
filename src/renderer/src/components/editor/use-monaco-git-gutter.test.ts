// @vitest-environment happy-dom
import * as monaco from 'monaco-editor'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createIdentityLineProjections } from '@/lib/diff-comparison/comparison-policy'
import { computeProjectedMonacoDiff } from '@/lib/diff-comparison/monaco-lines-diff'
import type {
  ComparisonResult,
  MonacoComparisonInput,
  SerializedLineChange
} from '@/lib/diff-comparison/comparison-types'

const comparison = vi.hoisted(() => ({
  requestComparison: vi.fn(),
  isComparisonCancellationError: vi.fn(() => false)
}))

vi.mock('@/lib/diff-comparison/comparison-client', () => comparison)

import { buildMonacoGitGutterDecorations, MonacoGitGutterController } from './use-monaco-git-gutter'

const models: monaco.editor.ITextModel[] = []

afterEach(() => {
  for (const model of models.splice(0)) {
    model.dispose()
  }
  comparison.requestComparison.mockReset()
  comparison.isComparisonCancellationError.mockReset()
  comparison.isComparisonCancellationError.mockReturnValue(false)
})

function model(value: string): monaco.editor.ITextModel {
  const created = monaco.editor.createModel(value, 'plaintext')
  models.push(created)
  return created
}

function diff(original: string, modified: string): SerializedLineChange[] {
  return computeProjectedMonacoDiff({
    original: createIdentityLineProjections(original),
    modified: createIdentityLineProjections(modified),
    maxComputationTimeMs: 1_000
  }).changes
}

function result(input: MonacoComparisonInput): ComparisonResult {
  return {
    id: 1,
    originalVersion: input.originalVersion,
    modifiedVersion: input.modifiedVersion,
    output: 'monaco',
    changes: diff(input.originalContent, input.modifiedContent),
    identical: input.originalContent === input.modifiedContent,
    quitEarly: false
  }
}

function gutterClasses(document: monaco.editor.ITextModel): string[] {
  return document
    .getAllDecorations()
    .map((decoration) => decoration.options.linesDecorationsClassName ?? '')
    .filter((className) => className.startsWith('orca-git-gutter'))
}

function editorFixture(initialModel: monaco.editor.ITextModel) {
  let currentModel = initialModel
  let decoratedModel = initialModel
  let decorationIds: string[] = []
  const modelListeners = new Set<() => void>()
  const collection = {
    clear(): void {
      decorationIds = decoratedModel.deltaDecorations(decorationIds, [])
    },
    set(decorations: monaco.editor.IModelDeltaDecoration[]): string[] {
      if (decoratedModel !== currentModel) {
        collection.clear()
        decoratedModel = currentModel
      }
      decorationIds = decoratedModel.deltaDecorations(decorationIds, decorations)
      return decorationIds
    }
  }
  const editor = {
    getModel: () => currentModel,
    onDidChangeModel: (listener: () => void) => {
      modelListeners.add(listener)
      return { dispose: () => modelListeners.delete(listener) }
    },
    createDecorationsCollection(decorations: monaco.editor.IModelDeltaDecoration[]) {
      collection.set(decorations)
      return collection
    }
  } as unknown as monaco.editor.IStandaloneCodeEditor
  return {
    editor,
    swap(nextModel: monaco.editor.ITextModel): void {
      collection.clear()
      currentModel = nextModel
      for (const listener of modelListeners) {
        listener()
      }
    }
  }
}

describe('Monaco Git gutter decorations', () => {
  it('uses real Monaco line computation while distinguishing empty source and destination from synthetic lines', () => {
    const added = buildMonacoGitGutterDecorations(model('new file'), diff('', 'new file'), '')
    const deleted = buildMonacoGitGutterDecorations(model(''), diff('old file', ''), 'old file')
    const replaced = buildMonacoGitGutterDecorations(
      model('first\nnew\nlast'),
      diff('first\nold\nlast', 'first\nnew\nlast'),
      'first\nold\nlast'
    )

    expect(added).toHaveLength(1)
    expect(added[0]?.options.linesDecorationsClassName).toBe('orca-git-gutter-added')
    expect(deleted).toHaveLength(1)
    expect(deleted[0]?.options.linesDecorationsClassName).toBe(
      'orca-git-gutter-deleted orca-git-gutter-deleted-before'
    )
    expect(deleted[0]?.range).toMatchObject({ startLineNumber: 1, endLineNumber: 1 })
    expect(replaced).toHaveLength(1)
    expect(replaced[0]?.options.linesDecorationsClassName).toBe('orca-git-gutter-modified')
  })

  it('anchors deletions before the first surviving line and after the last surviving line', () => {
    const beginning = buildMonacoGitGutterDecorations(
      model('kept'),
      [
        {
          originalStartLineNumber: 1,
          originalEndLineNumberExclusive: 2,
          modifiedStartLineNumber: 1,
          modifiedEndLineNumberExclusive: 1
        }
      ],
      'removed\nkept'
    )
    const end = buildMonacoGitGutterDecorations(
      model('kept'),
      [
        {
          originalStartLineNumber: 2,
          originalEndLineNumberExclusive: 3,
          modifiedStartLineNumber: 2,
          modifiedEndLineNumberExclusive: 2
        }
      ],
      'kept\nremoved'
    )

    expect(beginning[0]?.options.linesDecorationsClassName).toContain('deleted-before')
    expect(beginning[0]?.range).toMatchObject({ startLineNumber: 1, endLineNumber: 1 })
    expect(end[0]?.options.linesDecorationsClassName).toContain('deleted-after')
    expect(end[0]?.range).toMatchObject({ startLineNumber: 1, endLineNumber: 1 })
  })

  it('clears untrusted Git marks without removing unrelated decorations or accepting late results', async () => {
    const document = model('changed')
    document.deltaDecorations(
      [],
      [
        {
          range: new monaco.Range(1, 1, 1, 2),
          options: { className: 'independent-conflict-decoration' }
        }
      ]
    )
    const fixture = editorFixture(document)
    const completions: (() => void)[] = []
    comparison.requestComparison.mockImplementation(
      (input: MonacoComparisonInput) =>
        new Promise<ComparisonResult>((resolve) => completions.push(() => resolve(result(input))))
    )
    const controller = new MonacoGitGutterController(fixture.editor, {
      baseline: { content: 'original', identity: 'owner-a', version: 'head' },
      language: 'plaintext',
      showWhitespace: false
    })
    controller.start()
    completions.shift()?.()
    await Promise.resolve()
    expect(gutterClasses(document)).toEqual(['orca-git-gutter-modified'])

    document.applyEdits([{ range: document.getFullModelRange(), text: 'changed again' }])
    controller.update({ baseline: null, language: 'plaintext', showWhitespace: false })
    expect(gutterClasses(document)).toEqual([])
    completions.shift()?.()
    await Promise.resolve()
    expect(gutterClasses(document)).toEqual([])
    expect(
      document.getAllDecorations().map((decoration) => decoration.options.className)
    ).toContain('independent-conflict-decoration')
    controller.dispose()
    expect(document.isDisposed()).toBe(false)
  })

  it('keeps current marks through a typing burst and recomputes once after it settles', async () => {
    vi.useFakeTimers()
    try {
      const document = model('changed')
      const fixture = editorFixture(document)
      comparison.requestComparison.mockImplementation(async (input: MonacoComparisonInput) =>
        result(input)
      )
      const controller = new MonacoGitGutterController(fixture.editor, {
        baseline: { content: 'original', identity: 'owner-a', version: 'head' },
        language: 'plaintext',
        showWhitespace: false
      })
      controller.start()
      await vi.runAllTimersAsync()
      expect(gutterClasses(document)).toEqual(['orca-git-gutter-modified'])
      comparison.requestComparison.mockClear()

      for (const text of ['changed!', 'changed!!', 'changed!!!']) {
        document.applyEdits([{ range: document.getFullModelRange(), text }])
        expect(gutterClasses(document)).toEqual(['orca-git-gutter-modified'])
      }
      expect(comparison.requestComparison).not.toHaveBeenCalled()

      await vi.runAllTimersAsync()
      expect(comparison.requestComparison).toHaveBeenCalledTimes(1)
      expect(comparison.requestComparison.mock.calls[0]?.[0]).toMatchObject({
        modifiedContent: 'changed!!!'
      })
      expect(gutterClasses(document)).toEqual(['orca-git-gutter-modified'])

      document.applyEdits([{ range: document.getFullModelRange(), text: 'x' }])
      controller.dispose()
      await vi.runAllTimersAsync()
      expect(comparison.requestComparison).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('moves marks to a swapped model and preserves surviving models on disposal', async () => {
    const first = model('changed')
    const second = model('changed again')
    const fixture = editorFixture(first)
    const completions: (() => void)[] = []
    comparison.requestComparison.mockImplementation(
      (input: MonacoComparisonInput) =>
        new Promise<ComparisonResult>((resolve) => completions.push(() => resolve(result(input))))
    )
    const controller = new MonacoGitGutterController(fixture.editor, {
      baseline: { content: 'original', identity: 'owner-a', version: 'head' },
      language: 'plaintext',
      showWhitespace: false
    })
    controller.start()
    completions.shift()?.()
    await Promise.resolve()
    expect(gutterClasses(first)).toEqual(['orca-git-gutter-modified'])
    fixture.swap(second)
    completions.shift()?.()
    await Promise.resolve()
    expect(gutterClasses(first)).toEqual([])
    expect(gutterClasses(second)).toEqual(['orca-git-gutter-modified'])
    controller.dispose()
    expect(gutterClasses(second)).toEqual([])
    expect(first.isDisposed()).toBe(false)
    expect(second.isDisposed()).toBe(false)
  })
})
