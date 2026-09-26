import type { editor, IRange } from 'monaco-editor'
import type { SerializedLineChange } from '@/lib/diff-comparison/comparison-types'
import { normalizeComparisonLineEndings } from '@/lib/diff-comparison/comparison-policy'

export type GitHunkKind = 'added' | 'modified' | 'deleted'

export type GitHunkPeekRow = {
  kind: 'context' | 'removed' | 'added'
  originalLineNumber: number | null
  modifiedLineNumber: number | null
  text: string
}

const PEEK_CONTEXT_LINES = 2

export function splitGitBaselineLines(baseline: string): string[] {
  return normalizeComparisonLineEndings(baseline).split('\n')
}

// Monaco's line diff gives an empty document one synthetic line; the source
// bytes decide whether a side really has lines.
function sideHasLines(
  change: SerializedLineChange,
  originalContent: string,
  model: editor.ITextModel
): {
  original: boolean
  modified: boolean
} {
  return {
    original:
      originalContent.length > 0 &&
      change.originalStartLineNumber < change.originalEndLineNumberExclusive,
    modified:
      model.getValueLength() > 0 &&
      change.modifiedStartLineNumber < change.modifiedEndLineNumberExclusive
  }
}

export function getGitHunkKind(
  change: SerializedLineChange,
  originalContent: string,
  model: editor.ITextModel
): GitHunkKind | null {
  const has = sideHasLines(change, originalContent, model)
  if (has.original && has.modified) {
    return 'modified'
  }
  if (has.modified) {
    return 'added'
  }
  if (has.original) {
    return 'deleted'
  }
  return null
}

export function getDeletedLineAnchor(
  model: editor.ITextModel,
  modifiedStartLineNumber: number
): { range: IRange; side: 'before' | 'after' } {
  const lineCount = model.getLineCount()
  // An empty document's synthetic line is the only stable deletion anchor.
  if (model.getValueLength() === 0 || modifiedStartLineNumber <= 1) {
    return {
      range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
      side: 'before'
    }
  }
  if (
    modifiedStartLineNumber > lineCount ||
    (modifiedStartLineNumber === lineCount &&
      lineCount > 1 &&
      model.getLineMaxColumn(lineCount) === 1)
  ) {
    const anchorLine = Math.min(modifiedStartLineNumber - 1, lineCount)
    const column = model.getLineMaxColumn(anchorLine)
    return {
      range: {
        startLineNumber: anchorLine,
        startColumn: column,
        endLineNumber: anchorLine,
        endColumn: column
      },
      side: 'after'
    }
  }
  return {
    range: {
      startLineNumber: modifiedStartLineNumber,
      startColumn: 1,
      endLineNumber: modifiedStartLineNumber,
      endColumn: 1
    },
    side: 'before'
  }
}

/** The change whose gutter mark is drawn on `lineNumber`, preferring changed lines over deletion markers. */
export function findGitHunkIndexAtLine(
  model: editor.ITextModel,
  changes: readonly SerializedLineChange[],
  originalContent: string,
  lineNumber: number
): number | null {
  let deletionIndex: number | null = null
  for (const [index, change] of changes.entries()) {
    const kind = getGitHunkKind(change, originalContent, model)
    if (kind === 'added' || kind === 'modified') {
      if (
        lineNumber >= change.modifiedStartLineNumber &&
        lineNumber < change.modifiedEndLineNumberExclusive
      ) {
        return index
      }
    } else if (
      kind === 'deleted' &&
      deletionIndex === null &&
      getDeletedLineAnchor(model, change.modifiedStartLineNumber).range.startLineNumber ===
        lineNumber
    ) {
      deletionIndex = index
    }
  }
  return deletionIndex
}

/** Last editor line the peek zone renders beneath; 0 places it above line 1. */
export function getGitHunkPeekAfterLine(
  model: editor.ITextModel,
  change: SerializedLineChange,
  originalContent: string
): number {
  if (sideHasLines(change, originalContent, model).modified) {
    return change.modifiedEndLineNumberExclusive - 1
  }
  if (model.getValueLength() === 0) {
    return 0
  }
  return Math.min(change.modifiedStartLineNumber - 1, model.getLineCount())
}

/** One undoable edit that restores exactly this change's baseline lines. */
export function buildGitHunkRevertEdit(
  model: editor.ITextModel,
  change: SerializedLineChange,
  originalContent: string
): { range: IRange; text: string } {
  const eol = model.getEOL()
  const has = sideHasLines(change, originalContent, model)
  const original = has.original
    ? splitGitBaselineLines(originalContent).slice(
        change.originalStartLineNumber - 1,
        change.originalEndLineNumberExclusive - 1
      )
    : []
  const text = original.join(eol)
  const lineCount = model.getLineCount()
  const { modifiedStartLineNumber: start, modifiedEndLineNumberExclusive: end } = change

  if (has.modified) {
    const last = end - 1
    const lastColumn = model.getLineMaxColumn(last)
    if (original.length > 0) {
      return {
        range: {
          startLineNumber: start,
          startColumn: 1,
          endLineNumber: last,
          endColumn: lastColumn
        },
        text
      }
    }
    if (end <= lineCount) {
      return {
        range: { startLineNumber: start, startColumn: 1, endLineNumber: end, endColumn: 1 },
        text: ''
      }
    }
    if (start > 1) {
      return {
        range: {
          startLineNumber: start - 1,
          startColumn: model.getLineMaxColumn(start - 1),
          endLineNumber: last,
          endColumn: lastColumn
        },
        text: ''
      }
    }
    return {
      range: { startLineNumber: 1, startColumn: 1, endLineNumber: last, endColumn: lastColumn },
      text: ''
    }
  }

  const insertAtStart = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }
  if (model.getValueLength() === 0) {
    // The synthetic line either belongs to the change or is the retained empty final line.
    return { range: insertAtStart, text: start < end ? text : text + eol }
  }
  if (start <= lineCount) {
    return {
      range: { startLineNumber: start, startColumn: 1, endLineNumber: start, endColumn: 1 },
      text: text + eol
    }
  }
  const endColumn = model.getLineMaxColumn(lineCount)
  return {
    range: {
      startLineNumber: lineCount,
      startColumn: endColumn,
      endLineNumber: lineCount,
      endColumn
    },
    text: eol + text
  }
}

/** Baseline line number for a working line, or null when that line is itself changed. */
function originalLineNumberFor(
  changes: readonly SerializedLineChange[],
  modifiedLine: number
): number | null {
  let offset = 0
  for (const change of changes) {
    if (modifiedLine < change.modifiedStartLineNumber) {
      break
    }
    if (modifiedLine < change.modifiedEndLineNumberExclusive) {
      return null
    }
    offset = change.originalEndLineNumberExclusive - change.modifiedEndLineNumberExclusive
  }
  return modifiedLine + offset
}

export function buildGitHunkPeekRows(
  model: editor.ITextModel,
  changes: readonly SerializedLineChange[],
  index: number,
  originalContent: string
): GitHunkPeekRow[] {
  const change = changes[index]
  if (!change) {
    return []
  }
  const has = sideHasLines(change, originalContent, model)
  const baselineLines = splitGitBaselineLines(originalContent)
  const lineCount = model.getValueLength() === 0 ? 0 : model.getLineCount()
  const rows: GitHunkPeekRow[] = []
  const contextRow = (line: number): GitHunkPeekRow => ({
    kind: 'context',
    originalLineNumber: originalLineNumberFor(changes, line),
    modifiedLineNumber: line,
    text: model.getLineContent(line)
  })
  const firstContext = Math.max(1, change.modifiedStartLineNumber - PEEK_CONTEXT_LINES)
  for (
    let line = firstContext;
    line < change.modifiedStartLineNumber && line <= lineCount;
    line += 1
  ) {
    rows.push(contextRow(line))
  }
  if (has.original) {
    for (
      let line = change.originalStartLineNumber;
      line < change.originalEndLineNumberExclusive;
      line += 1
    ) {
      rows.push({
        kind: 'removed',
        originalLineNumber: line,
        modifiedLineNumber: null,
        text: baselineLines[line - 1] ?? ''
      })
    }
  }
  if (has.modified) {
    for (
      let line = change.modifiedStartLineNumber;
      line < change.modifiedEndLineNumberExclusive;
      line += 1
    ) {
      rows.push({
        kind: 'added',
        originalLineNumber: null,
        modifiedLineNumber: line,
        text: model.getLineContent(line)
      })
    }
  }
  const lastContext = Math.min(
    lineCount,
    change.modifiedEndLineNumberExclusive - 1 + PEEK_CONTEXT_LINES
  )
  for (let line = change.modifiedEndLineNumberExclusive; line <= lastContext; line += 1) {
    rows.push(contextRow(line))
  }
  return rows
}
