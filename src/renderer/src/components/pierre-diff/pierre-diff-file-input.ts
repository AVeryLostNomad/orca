import type { FileContents } from '@pierre/diffs/react'
import { getDiffContentSignature } from '../editor/diff-content-signature'

export type PierreDiffFileSource = {
  originalContent: string
  modifiedContent: string
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
  oldFile: FileContents
  newFile: FileContents
} {
  const oldFile: FileContents = {
    name: source.oldRelativePath ?? source.relativePath,
    contents: source.originalContent,
    cacheKey: `${source.cacheScope}:old:${getDiffContentSignature(source.originalContent)}`
  }
  const newFile: FileContents = {
    name: source.relativePath,
    contents: source.modifiedContent,
    cacheKey: `${source.cacheScope}:new:${getDiffContentSignature(source.modifiedContent)}`
  }
  return { oldFile, newFile }
}
