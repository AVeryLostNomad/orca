import type { FileContents } from '@pierre/diffs/react'
import { getDiffContentSignature } from '../editor/diff-content-signature'
import type { GitDiffTextResult } from '../../../../shared/git-diff-compare-types'

export type PierreDiffFileSource = {
  originalContent: string
  modifiedContent: string
  originalReadState?: GitDiffTextResult['originalReadState']
  modifiedReadState?: GitDiffTextResult['modifiedReadState']
  relativePath: string
  /** Pre-rename path for the old side, when the change is a rename. */
  oldRelativePath?: string
  /** Namespaces cacheKey so identical content in different tabs still dedupes safely. */
  cacheScope: string
}

/**
 * Adapt Orca's whole-file before/after diff payload (GitDiffTextResult) to the
 * @pierre/diffs input shape. The library computes the diff client-side.
 */
export function buildPierreDiffFileInput(source: PierreDiffFileSource): {
  oldFile: FileContents | null
  newFile: FileContents | null
} {
  return {
    oldFile:
      source.originalReadState === 'absent'
        ? null
        : {
            name: source.oldRelativePath ?? source.relativePath,
            contents: source.originalContent,
            cacheKey: `${source.cacheScope}:old:${getDiffContentSignature(source.originalContent)}`
          },
    newFile:
      source.modifiedReadState === 'absent'
        ? null
        : {
            name: source.relativePath,
            contents: source.modifiedContent,
            cacheKey: `${source.cacheScope}:new:${getDiffContentSignature(source.modifiedContent)}`
          }
  }
}
