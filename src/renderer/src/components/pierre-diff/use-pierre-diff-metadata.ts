import { useEffect, useMemo, useState } from 'react'
import { parseDiffFromFile } from '@pierre/diffs'
import type { FileContents, FileDiffMetadata } from '@pierre/diffs'
import PierreDiffParseWorker from './pierre-diff-parse.worker?worker'

// Why: jsdiff runs on the caller's thread; past this size a synchronous parse
// visibly freezes the renderer (Monaco computed diffs in a worker too).
export const PIERRE_DIFF_WORKER_PARSE_MIN_CHARS = 400_000

let sharedParseWorker: Worker | null = null
let nextRequestId = 1
const pendingParses = new Map<
  number,
  { resolve: (fileDiff: FileDiffMetadata) => void; reject: (error: Error) => void }
>()

function getParseWorker(): Worker {
  if (!sharedParseWorker) {
    sharedParseWorker = new PierreDiffParseWorker()
    sharedParseWorker.onmessage = (
      event: MessageEvent<{ id: number; fileDiff?: FileDiffMetadata; error?: string }>
    ) => {
      const pending = pendingParses.get(event.data.id)
      if (!pending) {
        return
      }
      pendingParses.delete(event.data.id)
      if (event.data.fileDiff) {
        pending.resolve(event.data.fileDiff)
      } else {
        pending.reject(new Error(event.data.error ?? 'Diff parse failed'))
      }
    }
  }
  return sharedParseWorker
}

function parseDiffInWorker(
  oldFile: FileContents,
  newFile: FileContents
): Promise<FileDiffMetadata> {
  return new Promise((resolve, reject) => {
    const id = nextRequestId++
    pendingParses.set(id, { resolve, reject })
    getParseWorker().postMessage({ id, oldFile, newFile })
  })
}

/**
 * Parse a before/after pair into FileDiffMetadata, off the main thread for
 * large contents. Returns null while an async parse is in flight.
 */
export function usePierreDiffMetadata(
  oldFile: FileContents,
  newFile: FileContents,
  disabled = false
): FileDiffMetadata | null {
  const totalChars = oldFile.contents.length + newFile.contents.length
  const syncFileDiff = useMemo(
    () =>
      !disabled && totalChars < PIERRE_DIFF_WORKER_PARSE_MIN_CHARS
        ? parseDiffFromFile(oldFile, newFile)
        : null,
    [oldFile, newFile, totalChars, disabled]
  )
  const [asyncFileDiff, setAsyncFileDiff] = useState<FileDiffMetadata | null>(null)

  useEffect(() => {
    if (syncFileDiff || disabled) {
      return
    }
    let cancelled = false
    setAsyncFileDiff(null)
    parseDiffInWorker(oldFile, newFile).then(
      (fileDiff) => {
        if (!cancelled) {
          setAsyncFileDiff(fileDiff)
        }
      },
      (error) => console.error('[pierre-diff] worker parse failed', error)
    )
    return () => {
      cancelled = true
    }
  }, [syncFileDiff, oldFile, newFile, disabled])

  return syncFileDiff ?? asyncFileDiff
}
