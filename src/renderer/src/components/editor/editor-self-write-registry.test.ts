import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  __clearSelfWriteRegistryForTests,
  __getSelfWriteRegistrySizeForTests,
  getRecentSelfWrite,
  recordSelfWrite,
  SELF_WRITE_REMOTE_TTL_MS
} from './editor-self-write-registry'

describe('document self write registry', () => {
  afterEach(() => {
    vi.useRealTimers()
    __clearSelfWriteRegistryForTests()
  })

  it('isolates equal paths by their owner-qualified document identities', () => {
    recordSelfWrite('local-document' as never, 'local')
    recordSelfWrite('remote-document' as never, 'remote')
    expect(getRecentSelfWrite('local-document' as never)?.content).toBe('local')
    expect(getRecentSelfWrite('remote-document' as never)?.content).toBe('remote')
  })

  it('retains remote write echoes for the remote transport window', () => {
    vi.useFakeTimers()
    recordSelfWrite('remote-document' as never, 'text', SELF_WRITE_REMOTE_TTL_MS)
    vi.advanceTimersByTime(751)
    expect(getRecentSelfWrite('remote-document' as never)?.content).toBe('text')
    expect(__getSelfWriteRegistrySizeForTests()).toBe(1)
  })
})
