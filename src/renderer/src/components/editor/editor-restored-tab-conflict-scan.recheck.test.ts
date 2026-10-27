import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readRuntimeFileContent: vi.fn(),
  runtimePathsExist: vi.fn()
}))

vi.mock('@/runtime/runtime-file-read-client', () => ({
  readRuntimeFileContent: mocks.readRuntimeFileContent
}))
vi.mock('@/runtime/runtime-path-existence-batch', () => ({
  runtimePathsExist: mocks.runtimePathsExist
}))
vi.mock('@/lib/connection-context', () => ({ getConnectionIdForFile: () => undefined }))
vi.mock('@/lib/file-owner-runtime-target', () => {
  const owner = { kind: 'environment', environmentId: 'env-1' }
  return {
    getRuntimeTargetForFileOwner: () => owner,
    requireRuntimeTargetForFileOwner: () => owner
  }
})

import { createTestStore } from '@/store/slices/store-test-helpers'
import {
  attachRestoredTabConflictScan,
  MAX_VERIFY_ATTEMPTS
} from './editor-restored-tab-conflict-scan'
import { getDiskBaselineSignature } from '../../../../shared/disk-baseline-signature'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'

const FILE = '/repo/a.ts'
let store: ReturnType<typeof createTestStore>
let detach: () => void

// A server's file is named by its owned id, not its path.
let fileId: string
let documentId: WorkingDocumentId
const document = () => store.getState().workingDocuments[documentId]!

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  store = createTestStore()
  fileId = store.getState().openFile({
    filePath: FILE,
    relativePath: 'a.ts',
    worktreeId: 'wt-1',
    runtimeEnvironmentId: 'env-1',
    language: 'typescript',
    mode: 'edit'
  })
  // A restored dirty document awaits a disk re-check against its persisted baseline.
  documentId = store.getState().retainWorkingDocument(fileId, {
    owner: { executionHostId: 'runtime:env-1', runtimeEnvironmentId: 'env-1' },
    filePath: FILE,
    worktreeId: 'wt-1',
    relativePath: 'a.ts',
    language: 'typescript',
    operationProvenance: {} as never
  })
  const loaded = document()
  store
    .getState()
    .acceptWorkingDocumentLoad(documentId, loaded.revision, 'v1', getDiskBaselineSignature('v1'))
  store.getState().setWorkingDocumentContent(documentId, 'unsaved')
  store
    .getState()
    .setWorkingDocumentExternalState(documentId, { pendingDiskBaselineVerification: true })
})

afterEach(() => {
  detach()
  vi.useRealTimers()
})

it('marks a dirty runtime-owned tab deleted when its host says the file is gone', async () => {
  mocks.readRuntimeFileContent.mockRejectedValue(new Error('read failed'))
  mocks.runtimePathsExist.mockResolvedValue([{ exists: false }])
  detach = attachRestoredTabConflictScan(store)
  await vi.advanceTimersByTimeAsync(0)

  expect(mocks.runtimePathsExist).toHaveBeenCalledWith(
    expect.objectContaining({ worktreePath: '/repo' }),
    [FILE],
    undefined,
    { codedAbsenceOnly: true }
  )
  expect(document().externalMutation).toBe('deleted')
})

it('stops retrying without a banner when the disk can never be checked', async () => {
  mocks.readRuntimeFileContent.mockRejectedValue(new Error('host unreachable'))
  mocks.runtimePathsExist.mockResolvedValue([{ error: 'unverifiable' }])
  detach = attachRestoredTabConflictScan(store)
  await vi.advanceTimersByTimeAsync(10 * 60_000)

  expect(mocks.readRuntimeFileContent).toHaveBeenCalledTimes(MAX_VERIFY_ATTEMPTS)
  // Why no banner: the guarded save refuses newer disk on its own.
  expect(document().externalMutation).toBeUndefined()
})
