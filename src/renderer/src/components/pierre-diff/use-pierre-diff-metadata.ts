import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FileContents, FileDiffMetadata } from '@pierre/diffs'
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
}

type MetadataState = {
  requestKey: string
  fileDiff: FileDiffMetadata | null
  error: string | null
}

function getComparisonVersion(file: FileContents | null): string {
  if (!file) {
    return 'absent'
  }
  // Why: Pierre's cache key includes the exact content signature at every
  // caller. Its name remains a separate identity for renamed files.
  return file.cacheKey ?? `${file.name}\0${file.contents}`
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

/**
 * Gets Pierre metadata from the shared semantic comparison worker. Results are
 * keyed to their exact request, so a completed old request never flashes while
 * a newer source pair is pending.
 */
export function usePierreDiffMetadata(
  oldFile: FileContents | null,
  newFile: FileContents | null,
  options: PierreDiffMetadataOptions
): { fileDiff: FileDiffMetadata | null; error: string | null; retry: () => void } {
  const disabled = options.disabled === true
  const { language, showWhitespace } = options
  const input = useMemo(
    () => createComparisonInput(oldFile, newFile, { language, showWhitespace }),
    [oldFile, newFile, language, showWhitespace]
  )
  const requestKey = useMemo(() => getComparisonRequestKey(input), [input])
  const [retryGeneration, setRetryGeneration] = useState(0)
  const [state, setState] = useState<MetadataState | null>(null)

  useEffect(() => {
    if (disabled) {
      return
    }

    const controller = new AbortController()
    void requestComparison(input, { signal: controller.signal }).then(
      (result) => {
        if (controller.signal.aborted || result.output !== 'pierre') {
          return
        }
        setState({ requestKey, fileDiff: result.fileDiff, error: null })
      },
      (error: unknown) => {
        if (controller.signal.aborted || isComparisonCancellationError(error)) {
          return
        }
        setState({
          requestKey,
          fileDiff: null,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    )
    return () => controller.abort()
  }, [disabled, input, requestKey, retryGeneration])

  const retry = useCallback(() => {
    if (disabled) {
      return
    }
    retryComparison(input)
    setState({ requestKey, fileDiff: null, error: null })
    setRetryGeneration((generation) => generation + 1)
  }, [disabled, input, requestKey])

  if (disabled || state?.requestKey !== requestKey) {
    return { fileDiff: null, error: null, retry }
  }
  return { fileDiff: state.fileDiff, error: state.error, retry }
}
