import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/orca-test-user-data' },
  net: { request: vi.fn() }
}))

import type { LspSessionEvent } from '../../shared/lsp-types'
import { LspSessionManager } from './lsp-session-manager'
import type { LspSession, LspSessionArgs } from './lsp-session'

type FakeSession = LspSession & {
  disposedForTest: boolean
  notifications: { method: string; params: unknown }[]
  triggerUnexpectedExit: () => void
}

function createFakeSessionFactory(behavior: { failStarts?: number } = {}): {
  sessions: FakeSession[]
  createSession: (args: LspSessionArgs) => LspSession
  startAttempts: () => number
} {
  const sessions: FakeSession[] = []
  let attempts = 0
  let remainingFailures = behavior.failStarts ?? 0
  const createSession = (args: LspSessionArgs): LspSession => {
    const fake = {
      serverId: args.entry.id,
      serverCapabilities: { hoverProvider: true },
      openDocuments: new Map<string, number>(),
      notifications: [] as { method: string; params: unknown }[],
      disposedForTest: false,
      async start() {
        attempts += 1
        if (remainingFailures > 0) {
          remainingFailures -= 1
          throw new Error('spawn failed')
        }
      },
      async request() {
        return { ok: true }
      },
      cancel() {},
      notify(method: string, params: unknown) {
        fake.notifications.push({ method, params })
      },
      respondToServerRequest() {},
      async dispose() {
        fake.disposedForTest = true
      },
      triggerUnexpectedExit() {
        args.onUnexpectedExit()
      }
    } as unknown as FakeSession
    sessions.push(fake)
    return fake
  }
  return { sessions, createSession, startAttempts: () => attempts }
}

const SPAWN_SPEC = { command: 'fake', args: [], env: {}, installRoot: '/tmp/fake' }

function createManager(
  factory: ReturnType<typeof createFakeSessionFactory>,
  options: { idleMs?: number } = {}
): { manager: LspSessionManager; events: { sessionId: string; event: LspSessionEvent }[] } {
  const events: { sessionId: string; event: LspSessionEvent }[] = []
  const manager = new LspSessionManager({
    emitEvent: (sessionId, event) => events.push({ sessionId, event }),
    idleShutdownMs: () => options.idleMs ?? 60_000,
    ensureServerAvailable: async () => SPAWN_SPEC,
    createSession: factory.createSession
  })
  return { manager, events }
}

beforeEach(() => {
  vi.useFakeTimers()
})

describe('LspSessionManager', () => {
  it('shares one session per (server, root) and single-flights the start', async () => {
    const factory = createFakeSessionFactory()
    const { manager } = createManager(factory)
    const [first, second] = await Promise.all([
      manager.ensureSession('typescript', '/repo', 1),
      manager.ensureSession('typescript', '/repo', 2)
    ])
    expect(first.ok && second.ok).toBe(true)
    if (first.ok && second.ok) {
      expect(first.sessionId).toBe(second.sessionId)
    }
    expect(factory.sessions).toHaveLength(1)
    expect(factory.startAttempts()).toBe(1)

    const other = await manager.ensureSession('typescript', '/other-repo', 1)
    expect(other.ok && first.ok && other.sessionId !== first.sessionId).toBe(true)
  })

  it('reports a failed start and lets a later ensure retry', async () => {
    const factory = createFakeSessionFactory({ failStarts: 1 })
    const { manager } = createManager(factory)
    const failed = await manager.ensureSession('typescript', '/repo', 1)
    expect(failed.ok).toBe(false)
    const retried = await manager.ensureSession('typescript', '/repo', 1)
    expect(retried.ok).toBe(true)
    expect(factory.startAttempts()).toBe(2)
  })

  it('drops duplicate didOpen from a second window and routes didChange by owner', async () => {
    const factory = createFakeSessionFactory()
    const { manager } = createManager(factory)
    const ensured = await manager.ensureSession('typescript', '/repo', 1)
    if (!ensured.ok) {
      throw new Error('ensure failed')
    }
    const open = {
      textDocument: { uri: 'file:///repo/a.ts', languageId: 'typescript', version: 1, text: 'x' }
    }
    manager.notify(ensured.sessionId, 'textDocument/didOpen', open, 1)
    manager.notify(ensured.sessionId, 'textDocument/didOpen', open, 2)
    const session = factory.sessions[0]
    expect(session.notifications.filter((n) => n.method === 'textDocument/didOpen')).toHaveLength(1)

    manager.notify(
      ensured.sessionId,
      'textDocument/didChange',
      { textDocument: { uri: 'file:///repo/a.ts', version: 2 }, contentChanges: [] },
      2
    )
    expect(session.notifications.some((n) => n.method === 'textDocument/didChange')).toBe(false)
    manager.notify(
      ensured.sessionId,
      'textDocument/didChange',
      { textDocument: { uri: 'file:///repo/a.ts', version: 2 }, contentChanges: [] },
      1
    )
    expect(session.notifications.some((n) => n.method === 'textDocument/didChange')).toBe(true)
  })

  it('idle-stops a session after its last document closes', async () => {
    const factory = createFakeSessionFactory()
    const { manager } = createManager(factory, { idleMs: 1000 })
    const ensured = await manager.ensureSession('typescript', '/repo', 1)
    if (!ensured.ok) {
      throw new Error('ensure failed')
    }
    manager.notify(
      ensured.sessionId,
      'textDocument/didOpen',
      {
        textDocument: { uri: 'file:///repo/a.ts', languageId: 'typescript', version: 1, text: '' }
      },
      1
    )
    manager.notify(
      ensured.sessionId,
      'textDocument/didClose',
      { textDocument: { uri: 'file:///repo/a.ts' } },
      1
    )
    await vi.advanceTimersByTimeAsync(1100)
    expect(factory.sessions[0].disposedForTest).toBe(true)
  })

  it("closes a departed window's documents and idle-stops when none remain", async () => {
    const factory = createFakeSessionFactory()
    const { manager } = createManager(factory, { idleMs: 1000 })
    const ensured = await manager.ensureSession('typescript', '/repo', 7)
    if (!ensured.ok) {
      throw new Error('ensure failed')
    }
    manager.notify(
      ensured.sessionId,
      'textDocument/didOpen',
      {
        textDocument: { uri: 'file:///repo/a.ts', languageId: 'typescript', version: 1, text: '' }
      },
      7
    )
    manager.releaseWebContents(7)
    const session = factory.sessions[0]
    expect(session.notifications.some((n) => n.method === 'textDocument/didClose')).toBe(true)
    await vi.advanceTimersByTimeAsync(1100)
    expect(session.disposedForTest).toBe(true)
  })

  it('restarts after an unexpected exit with a bumped epoch', async () => {
    const factory = createFakeSessionFactory()
    const { manager, events } = createManager(factory)
    const ensured = await manager.ensureSession('typescript', '/repo', 1)
    if (!ensured.ok) {
      throw new Error('ensure failed')
    }
    factory.sessions[0].triggerUnexpectedExit()
    await vi.advanceTimersByTimeAsync(600)
    // Let the restart's start() promise settle.
    await vi.advanceTimersByTimeAsync(0)
    expect(factory.sessions).toHaveLength(2)
    const readyEvents = events.filter(
      (entry) => entry.event.kind === 'status' && entry.event.status === 'ready'
    )
    expect(readyEvents.length).toBe(2)
    const epochs = readyEvents.map((entry) =>
      entry.event.kind === 'status' ? entry.event.epoch : -1
    )
    expect(epochs[1]).toBeGreaterThan(epochs[0])
  })

  it('stops restarting after repeated crashes and reports an error', async () => {
    const factory = createFakeSessionFactory()
    const { manager, events } = createManager(factory)
    const ensured = await manager.ensureSession('typescript', '/repo', 1)
    if (!ensured.ok) {
      throw new Error('ensure failed')
    }
    for (let crash = 0; crash < 4; crash++) {
      factory.sessions.at(-1)?.triggerUnexpectedExit()
      await vi.advanceTimersByTimeAsync(10_000)
    }
    const lastStatus = events.findLast((entry) => entry.event.kind === 'status')
    expect(lastStatus?.event.kind === 'status' && lastStatus.event.status).toBe('error')
  })

  it('forgives crashes separated by long clean uptime', async () => {
    const factory = createFakeSessionFactory()
    const { manager, events } = createManager(factory)
    const ensured = await manager.ensureSession('typescript', '/repo', 1)
    if (!ensured.ok) {
      throw new Error('ensure failed')
    }
    for (let crash = 0; crash < 6; crash++) {
      factory.sessions.at(-1)?.triggerUnexpectedExit()
      // Restart backoff, then enough uptime to reset the crash counter.
      await vi.advanceTimersByTimeAsync(10_000)
      await vi.advanceTimersByTimeAsync(61_000)
    }
    const lastStatus = events.findLast((entry) => entry.event.kind === 'status')
    expect(lastStatus?.event.kind === 'status' && lastStatus.event.status).toBe('ready')
  })

  it('disposes everything on shutdownAll and refuses new sessions', async () => {
    const factory = createFakeSessionFactory()
    const { manager } = createManager(factory)
    await manager.ensureSession('typescript', '/repo', 1)
    await manager.shutdownAll()
    expect(factory.sessions[0].disposedForTest).toBe(true)
    const after = await manager.ensureSession('typescript', '/repo', 1)
    expect(after.ok).toBe(false)
  })
})
