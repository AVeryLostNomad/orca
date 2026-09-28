import { describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { FILE_METHODS } from './files'

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

describe('background file open RPCs', () => {
  // Why: a stripped `activate` makes the host steal its own user's focus for every client open.
  it('keeps a background open request through param validation', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      openMobileFile: vi.fn().mockResolvedValue({ opened: true }),
      openMobileDiff: vi.fn().mockResolvedValue({ opened: true })
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: FILE_METHODS })

    await dispatcher.dispatch(
      makeRequest('files.open', {
        worktree: 'id:wt-1',
        relativePath: 'docs/readme.md',
        activate: false
      })
    )
    await dispatcher.dispatch(
      makeRequest('files.openDiff', {
        worktree: 'id:wt-1',
        relativePath: 'docs/readme.md',
        staged: false,
        activate: false
      })
    )

    expect(runtime.openMobileFile).toHaveBeenCalledWith('id:wt-1', 'docs/readme.md', false)
    expect(runtime.openMobileDiff).toHaveBeenCalledWith('id:wt-1', 'docs/readme.md', false, false)
  })
})
