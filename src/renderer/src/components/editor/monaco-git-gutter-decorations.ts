import type { editor, IRange } from 'monaco-editor'
import type { SerializedLineChange } from '@/lib/diff-comparison/comparison-types'
import { getDeletedLineAnchor, getGitHunkKind } from './git-gutter-hunks'

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
