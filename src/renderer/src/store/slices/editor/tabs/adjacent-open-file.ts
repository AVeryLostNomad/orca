import type { OpenFile } from '../types/open-file'

/** The next still-open file after `preferredFileId`, else the nearest one before it. */
export function findAdjacentOpenFileId(
  files: readonly OpenFile[],
  closedFileIds: ReadonlySet<string>,
  preferredFileId: string | null
): string | null {
  const preferredIndex = files.findIndex((file) => file.id === preferredFileId)
  const nextFile = files
    .slice(Math.max(preferredIndex + 1, 0))
    .find((file) => !closedFileIds.has(file.id))
  if (nextFile) {
    return nextFile.id
  }
  return (
    files
      .slice(0, Math.max(preferredIndex, 0))
      .toReversed()
      .find((file) => !closedFileIds.has(file.id))?.id ?? null
  )
}
