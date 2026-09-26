import { useMemo } from 'react'
import { cloneFileDiffMetadata } from '@pierre/diffs'
import type { FileDiffMetadata, FileDiffOptions, Hunk } from '@pierre/diffs'

function createEditableContextDiff(fileDiff: FileDiffMetadata): FileDiffMetadata {
  const lineCount = fileDiff.additionLines.length
  if (fileDiff.hunks.length > 0 || lineCount === 0 || fileDiff.deletionLines.length !== lineCount) {
    return fileDiff
  }
  const noEOFCRDeletions = !fileDiff.deletionLines[lineCount - 1]!.endsWith('\n')
  const contextHunk: Hunk = {
    collapsedBefore: 0,
    additionStart: 1,
    additionCount: lineCount,
    additionLines: 0,
    additionLineIndex: 0,
    deletionStart: 1,
    deletionCount: lineCount,
    deletionLines: 0,
    deletionLineIndex: 0,
    hunkContent: [
      { type: 'context', lines: lineCount, additionLineIndex: 0, deletionLineIndex: 0 }
    ],
    splitLineStart: 0,
    splitLineCount: lineCount,
    unifiedLineStart: 0,
    unifiedLineCount: lineCount,
    noEOFCRDeletions,
    noEOFCRAdditions: !fileDiff.additionLines[lineCount - 1]!.endsWith('\n')
  }
  return {
    ...fileDiff,
    hunks: [contextHunk],
    splitLineCount: lineCount,
    unifiedLineCount: lineCount
  }
}

/** Isolates worker-owned metadata before Pierre's native edit session mutates it. */
export function useEditablePierreFileDiff<LAnnotation>(
  fileDiff: FileDiffMetadata | null,
  options: FileDiffOptions<LAnnotation>,
  edit: boolean,
  generation: number
): { fileDiff: FileDiffMetadata | null; options: FileDiffOptions<LAnnotation> } {
  return useMemo(() => {
    const semanticFileDiff = edit && fileDiff ? createEditableContextDiff(fileDiff) : fileDiff
    if (!edit || !semanticFileDiff) {
      return { fileDiff: semanticFileDiff, options }
    }
    const renderedFileDiff = cloneFileDiffMetadata(semanticFileDiff)
    const semanticCacheKey =
      semanticFileDiff.cacheKey ??
      `${semanticFileDiff.prevName ?? semanticFileDiff.name}:${semanticFileDiff.name}`
    renderedFileDiff.cacheKey = `${semanticCacheKey}:semantic:${generation}`
    const effectiveOptions =
      semanticFileDiff.hunks.length === 1 && fileDiff?.hunks.length === 0
        ? { ...options, expandUnchanged: true }
        : options
    return { fileDiff: renderedFileDiff, options: effectiveOptions }
  }, [edit, fileDiff, generation, options])
}
