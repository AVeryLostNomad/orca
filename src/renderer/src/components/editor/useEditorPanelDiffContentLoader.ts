import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { OpenFile } from '@/store/slices/editor'
import { getConnectionIdForFile, isWorktreeConnectionResolved } from '@/lib/connection-context'
import { useAppStore } from '@/store'
import { settingsForRuntimeOwner } from '@/runtime/runtime-rpc-client'
import {
  getRuntimeGitBranchDiff,
  getRuntimeGitCommitDiff,
  getRuntimeGitDiff,
  getRuntimeGitScope
} from '@/runtime/runtime-git-client'
import {
  WORKTREE_OWNER_NOT_READY_ERROR,
  type DiffContent,
  type FileContent,
  type InFlightContentRead
} from './editor-panel-content-types'
import { getEditorGitBaselineScope } from './editor-panel-file-mode'
import type { EditorPanelContentLoadOptions } from './useEditorPanelExternalContentEvents'

const inFlightDiffReads = new Map<string, InFlightContentRead<DiffContent>>()

export type EditorPanelDiffContentLoader = (
  file: OpenFile | null,
  options?: EditorPanelContentLoadOptions
) => Promise<void>

type UseEditorPanelDiffContentLoaderParams = {
  fileContentsRef: MutableRefObject<Record<string, FileContent>>
  diffReadGenerationCounterRef: MutableRefObject<number>
  diffReadGenerationRef: MutableRefObject<Record<string, number>>
  outstandingDiffReadsRef: MutableRefObject<Record<string, number>>
  setDiffContents: Dispatch<SetStateAction<Record<string, DiffContent>>>
}

function inFlightDiffKey(
  file: OpenFile,
  connectionId: string | undefined,
  compareAgainstHead = false
): string {
  const branch =
    file.diffSource === 'branch' && file.branchCompare
      ? `${file.branchCompare.baseOid ?? ''}..${file.branchCompare.headOid ?? ''}::${file.branchOldPath ?? ''}`
      : ''
  const commit =
    file.diffSource === 'commit' && file.commitCompare
      ? `${file.commitCompare.parentOid ?? 'empty-tree'}..${file.commitCompare.commitOid}::${file.branchOldPath ?? ''}`
      : ''
  return `${connectionId ?? ''}::${file.diffSource ?? ''}::${compareAgainstHead ? 'head' : 'default'}::${file.filePath}::${branch}::${commit}`
}

export function useEditorPanelDiffContentLoader({
  fileContentsRef,
  diffReadGenerationCounterRef,
  diffReadGenerationRef,
  outstandingDiffReadsRef,
  setDiffContents
}: UseEditorPanelDiffContentLoaderParams): EditorPanelDiffContentLoader {
  return useCallback(
    async (file: OpenFile | null, options?: EditorPanelContentLoadOptions): Promise<void> => {
      if (!file) {
        return
      }
      const baselineScope =
        file.mode === 'edit' ? getEditorGitBaselineScope(useAppStore.getState(), file) : null
      if (
        file.mode === 'edit' &&
        (baselineScope === null ||
          fileContentsRef.current[file.id]?.isBinary !== false ||
          fileContentsRef.current[file.id]?.loadError)
      ) {
        return
      }
      const generation = diffReadGenerationCounterRef.current + 1
      diffReadGenerationCounterRef.current = generation
      diffReadGenerationRef.current[file.id] = generation
      outstandingDiffReadsRef.current[file.id] = generation
      try {
        const worktreePath = file.filePath.slice(
          0,
          file.filePath.length - file.relativePath.length - 1
        )
        const branchCompare =
          file.branchCompare?.baseOid && file.branchCompare.headOid && file.branchCompare.mergeBase
            ? file.branchCompare
            : null
        const commitCompare = file.commitCompare?.commitOid ? file.commitCompare : null
        const connectionId = getConnectionIdForFile(file.worktreeId, file.filePath) ?? undefined
        const activeSettings = useAppStore.getState().settings
        const fileSettings = settingsForRuntimeOwner(activeSettings, file.runtimeEnvironmentId)
        if (
          connectionId === undefined &&
          !fileSettings?.activeRuntimeEnvironmentId?.trim() &&
          !isWorktreeConnectionResolved(file.worktreeId)
        ) {
          throw new Error(WORKTREE_OWNER_NOT_READY_ERROR)
        }
        const gitScope = getRuntimeGitScope(fileSettings, connectionId)
        const effectiveDiffSource: typeof file.diffSource =
          file.mode === 'edit' ? 'unstaged' : file.diffSource
        const compareAgainstHead = file.mode === 'edit'
        const key = `${inFlightDiffKey(
          { ...file, diffSource: effectiveDiffSource },
          gitScope ?? undefined,
          compareAgainstHead
        )}::${baselineScope ?? ''}`
        const registeredRead = inFlightDiffReads.get(key)
        if (
          options?.force &&
          (options.externalEventGeneration === undefined ||
            registeredRead?.externalEventGeneration !== options.externalEventGeneration)
        ) {
          // Why: forced diff reloads must not attach to a read started before
          // the external change landed.
          inFlightDiffReads.delete(key)
        }
        let pending = inFlightDiffReads.get(key)
        if (!pending) {
          const promise = (
            effectiveDiffSource === 'commit'
              ? commitCompare
                ? getRuntimeGitCommitDiff(
                    {
                      settings: fileSettings,
                      worktreeId: file.worktreeId,
                      worktreePath,
                      connectionId
                    },
                    {
                      commitOid: commitCompare.commitOid,
                      parentOid: commitCompare.parentOid,
                      filePath: file.relativePath,
                      oldPath: file.branchOldPath
                    }
                  )
                : Promise.reject(new Error('Missing commit comparison for diff tab.'))
              : effectiveDiffSource === 'branch' && branchCompare
                ? getRuntimeGitBranchDiff(
                    {
                      settings: fileSettings,
                      worktreeId: file.worktreeId,
                      worktreePath,
                      connectionId
                    },
                    {
                      compare: {
                        baseRef: branchCompare.baseRef,
                        baseOid: branchCompare.baseOid!,
                        headOid: branchCompare.headOid!,
                        mergeBase: branchCompare.mergeBase!
                      },
                      filePath: file.relativePath,
                      oldPath: file.branchOldPath
                    }
                  )
                : getRuntimeGitDiff(
                    {
                      settings: fileSettings,
                      worktreeId: file.worktreeId,
                      worktreePath,
                      connectionId
                    },
                    {
                      filePath: file.relativePath,
                      staged: effectiveDiffSource === 'staged',
                      compareAgainstHead
                    }
                  )
          ) as Promise<DiffContent>
          pending = { externalEventGeneration: options?.externalEventGeneration, promise }
          inFlightDiffReads.set(key, pending)
          const clearRegisteredRead = (): void => {
            if (inFlightDiffReads.get(key) === pending) {
              inFlightDiffReads.delete(key)
            }
          }
          void promise.then(clearRegisteredRead, clearRegisteredRead)
        }
        const result = await pending.promise
        if (diffReadGenerationRef.current[file.id] !== generation) {
          return
        }
        setDiffContents((prev) => ({
          ...prev,
          [file.id]:
            baselineScope === null ? result : { ...result, gitBaselineScope: baselineScope }
        }))
      } catch (err) {
        if (diffReadGenerationRef.current[file.id] !== generation) {
          return
        }
        setDiffContents((prev) => ({
          ...prev,
          [file.id]: {
            kind: 'error',
            message: String(err)
          }
        }))
      } finally {
        if (outstandingDiffReadsRef.current[file.id] === generation) {
          delete outstandingDiffReadsRef.current[file.id]
        }
      }
    },
    [
      fileContentsRef,
      diffReadGenerationCounterRef,
      diffReadGenerationRef,
      outstandingDiffReadsRef,
      setDiffContents
    ]
  )
}
