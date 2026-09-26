import { readFile, stat } from 'node:fs/promises'
import type { GitDiffReadState } from './git-blob-read-state'
import { bufferToBlob } from './git-handler-utils'
const MAX_RELAY_DIFF_WORKING_FILE_BYTES = 10 * 1024 * 1024

export async function readWorkingDiffFile(
  absPath: string
): Promise<{ content: string; isBinary: boolean; readState: GitDiffReadState }> {
  let fileStat
  try {
    fileStat = await stat(absPath)
  } catch (error) {
    // Why: only a missing path proves deletion; permission and transport failures
    // must not create an empty writable baseline.
    const readState: GitDiffReadState =
      (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'absent' : 'unavailable'
    return { content: '', isBinary: false, readState }
  }
  if (!fileStat.isFile()) {
    return { content: '', isBinary: false, readState: 'unavailable' }
  }
  if (fileStat.size > MAX_RELAY_DIFF_WORKING_FILE_BYTES) {
    // Why: mirror local git diff reads, which cap blob transfer at 10MB.
    return { content: '', isBinary: true, readState: 'present' }
  }
  try {
    const buffer = await readFile(absPath)
    // Why: bufferToBlob needs the path's extension to know an image is
    // previewable; omitting it made every relay-side binary diff empty.
    return { ...bufferToBlob(buffer, absPath), readState: 'present' }
  } catch {
    // Why: the file exists but could not be read — a read failure, not a deletion.
    return { content: '', isBinary: false, readState: 'unavailable' }
  }
}
