import {
  assertFileWriteApplied,
  missingOrIdenticalPrecondition,
  type FileWriteDiskPrecondition,
  type FileWriteResult
} from '../../../../shared/file-write-disk-precondition'
import type { TreeNode } from './file-explorer-types'

export type DeletedFileUndoSnapshot = {
  content: string
  /** Unity `.meta` that main deletes alongside a local asset. */
  metaContent?: string
}

type ReadSnapshotFile = (
  filePath: string,
  relativePath: string
) => Promise<{ content: string; isBinary?: boolean }>

async function readTextSnapshot(
  readFile: ReadSnapshotFile,
  filePath: string,
  relativePath: string
): Promise<string | undefined> {
  try {
    const file = await readFile(filePath, relativePath)
    return file.isBinary ? undefined : file.content
  } catch {
    // Unreadable snapshots cannot safely support undo.
    return undefined
  }
}

/** Text snapshot taken before deletion; directories and binary files have none. */
export async function snapshotDeletedFileForUndo(
  node: Pick<TreeNode, 'path' | 'relativePath' | 'isDirectory'>,
  isLocal: boolean,
  readFile: ReadSnapshotFile
): Promise<DeletedFileUndoSnapshot | undefined> {
  if (node.isDirectory) {
    return undefined
  }
  const content = await readTextSnapshot(readFile, node.path, node.relativePath)
  if (content === undefined) {
    return undefined
  }
  // Why no Unity-root check: main decides membership itself; a stray snapshot restores as a no-op.
  const metaContent =
    isLocal && !node.path.toLowerCase().endsWith('.meta')
      ? await readTextSnapshot(readFile, `${node.path}.meta`, `${node.relativePath}.meta`)
      : undefined
  return { content, metaContent }
}

export async function restoreDeletedFileForUndo(
  path: string,
  snapshot: DeletedFileUndoSnapshot,
  writeFile: (
    filePath: string,
    content: string,
    precondition: FileWriteDiskPrecondition
  ) => Promise<FileWriteResult>
): Promise<void> {
  // Why: the meta goes first so Unity imports the asset with its original GUID; best-effort
  // because a meta Unity regenerated since the delete wins over the snapshot.
  if (snapshot.metaContent !== undefined) {
    try {
      assertFileWriteApplied(
        await writeFile(
          `${path}.meta`,
          snapshot.metaContent,
          missingOrIdenticalPrecondition(snapshot.metaContent)
        )
      )
    } catch (error) {
      console.warn('[unity] failed to restore .meta companion', path, error)
    }
  }
  // Undo must not overwrite a path recreated since deletion.
  assertFileWriteApplied(
    await writeFile(path, snapshot.content, missingOrIdenticalPrecondition(snapshot.content))
  )
}
