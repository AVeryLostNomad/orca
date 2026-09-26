/** @vitest-environment happy-dom */
import { act, renderHook, waitFor } from '@testing-library/react'
import { parseDiffFromFile, type FileContents } from '@pierre/diffs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  PierreComparisonInput,
  PierreComparisonResult
} from '@/lib/diff-comparison/comparison-types'

// Why: the hook imports the client before ordinary Vitest mocks are installed.
const mocks = vi.hoisted(() => ({
  getComparisonRequestKey: vi.fn(
    (input: { originalVersion: string | number; modifiedVersion: string | number }) =>
      `${input.originalVersion}:${input.modifiedVersion}`
  ),
  requestComparison: vi.fn(),
  isComparisonCancellationError: vi.fn(() => false),
  retryComparison: vi.fn()
}))

vi.mock('@/lib/diff-comparison/comparison-client', () => mocks)

import { usePierreDiffMetadata } from './use-pierre-diff-metadata'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function file(name: string, contents: string): FileContents {
  return { name, contents, cacheKey: `${name}:${contents}` }
}

function resultFor(
  input: PierreComparisonInput,
  original: string,
  modified: string
): PierreComparisonResult {
  return {
    id: 1,
    output: 'pierre',
    originalVersion: input.originalVersion,
    modifiedVersion: input.modifiedVersion,
    quitEarly: false,
    fileDiff: parseDiffFromFile(file('old.ts', original), file('new.ts', modified))
  }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('usePierreDiffMetadata', () => {
  it('does not expose a completed stale request after source changes', async () => {
    const stale = deferred<PierreComparisonResult>()
    const fresh = deferred<PierreComparisonResult>()
    mocks.requestComparison.mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise)
    const oldFile = file('old.ts', 'const value = 1\n')
    const { result, rerender } = renderHook(
      ({ newFile }) =>
        usePierreDiffMetadata(oldFile, newFile, { language: 'typescript', showWhitespace: false }),
      { initialProps: { newFile: file('new.ts', 'const value = 2\n') } }
    )
    await waitFor(() => expect(mocks.requestComparison).toHaveBeenCalledTimes(1))
    rerender({ newFile: file('new.ts', 'const value = 3\n') })
    await waitFor(() => expect(mocks.requestComparison).toHaveBeenCalledTimes(2))
    expect(result.current.fileDiff).toBeNull()
    expect(result.current.error).toBeNull()

    const freshInput = mocks.requestComparison.mock.calls[1]![0] as PierreComparisonInput
    const freshResult = resultFor(freshInput, oldFile.contents, 'const value = 3\n')
    await act(async () => fresh.resolve(freshResult))
    await waitFor(() => expect(result.current.fileDiff).toBe(freshResult.fileDiff))

    const staleInput = mocks.requestComparison.mock.calls[0]![0] as PierreComparisonInput
    await act(async () =>
      stale.resolve(resultFor(staleInput, oldFile.contents, 'const value = 2\n'))
    )
    expect(result.current.fileDiff).toBe(freshResult.fileDiff)
  })

  it('settles errors and retries only the current comparison pair', async () => {
    mocks.requestComparison.mockRejectedValueOnce(new Error('Tokenizer unavailable'))
    const oldFile = file('old.ts', 'const value = 1\n')
    const newFile = file('new.ts', 'const value = 2\n')
    const { result } = renderHook(() =>
      usePierreDiffMetadata(oldFile, newFile, { language: 'typescript', showWhitespace: false })
    )

    await waitFor(() => expect(result.current.error).toBe('Tokenizer unavailable'))
    const retried = deferred<PierreComparisonResult>()
    mocks.requestComparison.mockReturnValueOnce(retried.promise)
    act(() => result.current.retry())

    expect(mocks.retryComparison).toHaveBeenCalledWith(
      expect.objectContaining({
        originalContent: oldFile.contents,
        modifiedContent: newFile.contents
      })
    )
    expect(result.current).toMatchObject({ fileDiff: null, error: null })

    const retryInput = mocks.requestComparison.mock.calls[1]![0] as PierreComparisonInput
    await act(async () =>
      retried.resolve(resultFor(retryInput, oldFile.contents, newFile.contents))
    )
    await waitFor(() => expect(result.current.fileDiff).not.toBeNull())
    expect(result.current.error).toBeNull()
  })
})
