import { useCallback, useEffect, useRef, useState } from 'react'
import type { editor } from 'monaco-editor'
import {
  getComparisonFailure,
  getComparisonRequestKey,
  retryComparison,
  subscribeComparisonFailures
} from '@/lib/diff-comparison/comparison-client'
import type { ComparisonInput } from '@/lib/diff-comparison/comparison-types'
import { getMonacoModelSnapshot } from '@/lib/monaco-model-snapshot'

type ComparisonSnapshot = {
  input: ComparisonInput
  key: string
}

function createSnapshot(
  original: editor.ITextModel | null,
  modified: editor.ITextModel | null,
  showWhitespace: boolean
): ComparisonSnapshot | null {
  if (!original || !modified || original.isDisposed() || modified.isDisposed()) {
    return null
  }
  const originalSource = getMonacoModelSnapshot(original)
  const modifiedSource = getMonacoModelSnapshot(modified)
  const input: ComparisonInput = {
    output: 'monaco',
    originalContent: originalSource.content,
    modifiedContent: modifiedSource.content,
    language: modifiedSource.language,
    showWhitespace,
    originalVersion: originalSource.alternativeVersion,
    modifiedVersion: modifiedSource.alternativeVersion,
    originalIdentity: originalSource.identity,
    modifiedIdentity: modifiedSource.identity
  }
  return { input, key: getComparisonRequestKey(input) }
}

/** Keeps an error bound to the exact live model pair that produced it. */
export function useDiffComparisonFailure({
  original,
  modified,
  showWhitespace
}: {
  original: editor.ITextModel | null
  modified: editor.ITextModel | null
  showWhitespace: boolean
}): { error: string | null; retry: () => void } {
  const [snapshot, setSnapshot] = useState<ComparisonSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const snapshotRef = useRef<ComparisonSnapshot | null>(null)

  useEffect(() => {
    const synchronize = (): void => {
      const next = createSnapshot(original, modified, showWhitespace)
      snapshotRef.current = next
      setSnapshot(next)
      setError(next ? getComparisonFailure(next.key) : null)
    }
    synchronize()
    const originalSubscription = original?.onDidChangeContent(synchronize)
    const modifiedSubscription = modified?.onDidChangeContent(synchronize)
    const languageSubscription = modified?.onDidChangeLanguage(synchronize)
    return () => {
      originalSubscription?.dispose()
      modifiedSubscription?.dispose()
      languageSubscription?.dispose()
    }
  }, [original, modified, showWhitespace])

  useEffect(() => {
    if (!snapshot) {
      return
    }
    return subscribeComparisonFailures((key, nextError) => {
      if (key === snapshot.key) {
        setError(nextError)
      }
    })
  }, [snapshot])

  const retry = useCallback(() => {
    const current = snapshotRef.current
    if (!current) {
      return
    }
    setError(null)
    retryComparison(current.input)
  }, [])

  return { error, retry }
}
