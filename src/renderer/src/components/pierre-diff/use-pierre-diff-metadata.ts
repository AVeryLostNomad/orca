import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FileContents, FileDiffMetadata } from '@pierre/diffs'
import { getDiffContentSignature } from '../editor/diff-content-signature'
import type { PierreComparisonInput } from '@/lib/diff-comparison/comparison-types'
import {
  getComparisonRequestKey,
  isComparisonCancellationError,
  requestComparison,
  retryComparison
} from '@/lib/diff-comparison/comparison-client'

export type PierreDiffMetadataOptions = {
  disabled?: boolean
  language: string
  showWhitespace: boolean
  /** Retain rendered hunks while the same native editor awaits a semantic refresh. */
  retainPreviousWhilePending?: boolean
  /** Owner boundary that prevents stale metadata crossing working documents. */
  workingDocumentId?: string
}

type MetadataState = {
  requestKey: string
  retentionKey: string
  fileDiff: FileDiffMetadata | null
  error: string | null
  generation: number
}

function getComparisonVersion(file: FileContents | null): string {
  if (!file) {
    return 'absent'
  }
  // Semantic comparison must follow every text revision even while native edit
  // state remains attached to the working document.
  return `${file.name}\0${getDiffContentSignature(file.contents)}`
}

function createComparisonInput(
  oldFile: FileContents | null,
  newFile: FileContents | null,
  options: PierreDiffMetadataOptions
): PierreComparisonInput {
  return {
    output: 'pierre',
    oldFile,
    newFile,
    originalContent: oldFile?.contents ?? '',
    modifiedContent: newFile?.contents ?? '',
    originalIdentity: oldFile?.name,
    modifiedIdentity: newFile?.name,
    originalVersion: getComparisonVersion(oldFile),
    modifiedVersion: getComparisonVersion(newFile),
    language: options.language,
    showWhitespace: options.showWhitespace
  }
}

function getRetentionKey(
  oldFile: FileContents | null,
  options: Pick<PierreDiffMetadataOptions, 'language' | 'showWhitespace' | 'workingDocumentId'>
): string {
  return [
    getComparisonVersion(oldFile),
    options.language,
    options.showWhitespace ? 'whitespace' : 'semantic',
    options.workingDocumentId ?? ''
  ].join('\0')
}

/** Gets Pierre metadata from the shared semantic comparison worker. */
export function usePierreDiffMetadata(
  oldFile: FileContents | null,
  newFile: FileContents | null,
  options: PierreDiffMetadataOptions
): {
  fileDiff: FileDiffMetadata | null
  error: string | null
  generation: number
  retry: () => void
} {
  const disabled = options.disabled === true
  const { language, showWhitespace, retainPreviousWhilePending, workingDocumentId } = options
  const input = useMemo(
    () => createComparisonInput(oldFile, newFile, { language, showWhitespace }),
    [oldFile, newFile, language, showWhitespace]
  )
  const requestKey = useMemo(() => getComparisonRequestKey(input), [input])
  const retentionKey = useMemo(
    () => getRetentionKey(oldFile, { language, showWhitespace, workingDocumentId }),
    [language, oldFile, showWhitespace, workingDocumentId]
  )
  const [retryGeneration, setRetryGeneration] = useState(0)
  const [state, setState] = useState<MetadataState | null>(null)

  useEffect(() => {
    if (disabled) {
      return
    }
    const controller = new AbortController()
    void requestComparison(input, { signal: controller.signal }).then(
      (result) => {
        if (!controller.signal.aborted && result.output === 'pierre') {
          setState((previous) => ({
            requestKey,
            retentionKey,
            fileDiff: result.fileDiff,
            error: null,
            generation: (previous?.generation ?? 0) + 1
          }))
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted && !isComparisonCancellationError(error)) {
          setState((previous) => ({
            requestKey,
            retentionKey,
            fileDiff: null,
            error: error instanceof Error ? error.message : String(error),
            generation: previous?.generation ?? 0
          }))
        }
      }
    )
    return () => controller.abort()
  }, [disabled, input, requestKey, retentionKey, retryGeneration])

  const retry = useCallback(() => {
    if (!disabled) {
      retryComparison(input)
      setState((previous) => ({
        requestKey,
        retentionKey,
        fileDiff: null,
        error: null,
        generation: previous?.generation ?? 0
      }))
      setRetryGeneration((generation) => generation + 1)
    }
  }, [disabled, input, requestKey, retentionKey])

  if (disabled) {
    return { fileDiff: null, error: null, generation: 0, retry }
  }
  if (state?.requestKey !== requestKey) {
    const retainsActiveEdit =
      retainPreviousWhilePending === true &&
      state?.retentionKey === retentionKey &&
      state.fileDiff !== null
    return {
      fileDiff: retainsActiveEdit ? state.fileDiff : null,
      error: null,
      generation: state?.generation ?? 0,
      retry
    }
  }
  return { fileDiff: state.fileDiff, error: state.error, generation: state.generation, retry }
}
