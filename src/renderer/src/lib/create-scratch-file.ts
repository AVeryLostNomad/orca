import { createRuntimePath, runtimePathExists } from '../runtime/runtime-file-client'
import { joinPath } from './path'

export type ScratchFileInfo = {
  filePath: string
  relativePath: string
  worktreeId: string
  language: string
  isScratch: true
  alwaysAutoSave: true
  runtimeEnvironmentId: null
  mode: 'edit'
}

/** Auto-generated scratch names (`scratch.txt`, `scratch-2.sql`, …) — the only
 *  names content-based language detection is allowed to keep renaming. */
export const SCRATCH_FILE_NAME_PATTERN = /^scratch(?:-\d+)?\.[a-z0-9]+$/i

export const SCRATCH_FILE_BASE_NAME = 'scratch'
// Why: plaintext start — content-based detection renames the extension once the
// user pastes or types something recognizable.
const SCRATCH_INITIAL_EXT = '.txt'
const MAX_ATTEMPTS = 100

export function scratchFileNameForAttempt(attempt: number, extension: string): string {
  return attempt === 1
    ? `${SCRATCH_FILE_BASE_NAME}${extension}`
    : `${SCRATCH_FILE_BASE_NAME}-${attempt}${extension}`
}

/**
 * Creates an empty scratch file in the local app-owned scratch directory
 * (outside every worktree) and returns the metadata for `openFile`.
 *
 * Scratch files are local-only by design — the create menu gates the entry to
 * locally-owned workspaces, so runtime routing for the tab stays local even
 * though the tab carries a workspace worktreeId.
 */
export async function createScratchFile(worktreeId: string): Promise<ScratchFileInfo | null> {
  const scratchDirectory = await window.api.app.getScratchFileDirectory()
  if (!scratchDirectory) {
    return null
  }
  const context = {
    settings: { activeRuntimeEnvironmentId: null },
    worktreeId,
    worktreePath: scratchDirectory
  }

  // Why: 'wx' creation can still lose a race after the existence probe when two
  // groups create scratch files at once; retry EEXIST onto the next name.
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const fileName = scratchFileNameForAttempt(attempt, SCRATCH_INITIAL_EXT)
    const filePath = joinPath(scratchDirectory, fileName)

    if (await runtimePathExists(context, filePath)) {
      continue
    }

    try {
      await createRuntimePath(context, filePath, 'file')
      return {
        filePath,
        relativePath: fileName,
        worktreeId,
        language: 'plaintext',
        isScratch: true,
        alwaysAutoSave: true,
        runtimeEnvironmentId: null,
        mode: 'edit'
      }
    } catch (err) {
      const isEexist =
        err instanceof Error && (err.message.includes('EEXIST') || err.message.includes('exists'))
      if (isEexist && attempt < MAX_ATTEMPTS) {
        continue
      }
      throw err
    }
  }

  throw new Error(`Unable to create scratch file after ${MAX_ATTEMPTS} attempts.`)
}
