import { DefaultLinesDiffComputer } from 'monaco-editor/esm/vs/editor/common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer.js'
import type { SerializedLineChange, SerializedRange } from './comparison-types'
import { mapProjectedColumnToRaw } from './comparison-policy'
import type { LineProjection } from './comparison-policy'

type MonacoRange = {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

type MonacoRangeMapping = { originalRange: MonacoRange; modifiedRange: MonacoRange }
type MonacoDetailedChange = {
  original: { startLineNumber: number; endLineNumberExclusive: number }
  modified: { startLineNumber: number; endLineNumberExclusive: number }
  innerChanges?: readonly MonacoRangeMapping[]
}
type MonacoLinesDiff = { changes: readonly MonacoDetailedChange[]; hitTimeout: boolean }

function serializeRange(
  range: MonacoRange,
  projections: readonly LineProjection[]
): SerializedRange {
  const startProjection = projections[range.startLineNumber - 1]
  const endProjection = projections[range.endLineNumber - 1]
  if (!startProjection || !endProjection) {
    throw new Error('Monaco returned a range outside the projected source')
  }
  return [
    range.startLineNumber,
    mapProjectedColumnToRaw(startProjection, range.startColumn),
    range.endLineNumber,
    mapProjectedColumnToRaw(endProjection, range.endColumn)
  ]
}

/**
 * This is intentionally the pinned 0.55.1 Monaco implementation rather than a
 * second diff algorithm. The provider reconstructs Monaco range classes later.
 */
export function computeProjectedMonacoDiff({
  original,
  modified,
  maxComputationTimeMs
}: {
  original: readonly LineProjection[]
  modified: readonly LineProjection[]
  maxComputationTimeMs: number
}): { changes: SerializedLineChange[]; quitEarly: boolean } {
  const computer = new DefaultLinesDiffComputer() as {
    computeDiff(
      originalLines: readonly string[],
      modifiedLines: readonly string[],
      options: {
        ignoreTrimWhitespace: boolean
        maxComputationTimeMs: number
        computeMoves: boolean
      }
    ): MonacoLinesDiff
  }
  const result = computer.computeDiff(
    original.map((line) => line.projected),
    modified.map((line) => line.projected),
    { ignoreTrimWhitespace: false, maxComputationTimeMs, computeMoves: false }
  )
  return {
    quitEarly: result.hitTimeout,
    changes: result.changes.map((change) => {
      const innerChanges = change.innerChanges?.map((innerChange) => ({
        originalRange: serializeRange(innerChange.originalRange, original),
        modifiedRange: serializeRange(innerChange.modifiedRange, modified)
      }))
      return {
        originalStartLineNumber: change.original.startLineNumber,
        originalEndLineNumberExclusive: change.original.endLineNumberExclusive,
        modifiedStartLineNumber: change.modified.startLineNumber,
        modifiedEndLineNumberExclusive: change.modified.endLineNumberExclusive,
        ...(innerChanges && innerChanges.length > 0 ? { innerChanges } : {})
      }
    })
  }
}
