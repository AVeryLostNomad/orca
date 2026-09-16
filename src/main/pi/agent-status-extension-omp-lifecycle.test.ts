import { describe, expect, it, vi } from 'vitest'

import { createAgentStatusExtensionHarness } from './agent-status-extension-test-harness'

function postedHookNames(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map(
    (call) => JSON.parse(String(call[1]?.body)).payload.hook_event_name as string
  )
}

const OMP_RUNTIME_CASES = [
  ['configured OMP', { kind: 'omp' as const }],
  ['title-routed OMP', { kind: 'pi' as const, title: 'omp' }],
  ['argv-routed OMP', { kind: 'pi' as const, argv: ['node', '/usr/local/bin/omp'] }]
] as const

describe('OMP agent_end contract', () => {
  it.each(OMP_RUNTIME_CASES)(
    'keeps %s working when agent_end will continue',
    async (_name, args) => {
      vi.useFakeTimers()
      try {
        const harness = createAgentStatusExtensionHarness(args)
        const context = { isIdle: vi.fn(() => true) }

        await harness.callHook('agent_start')
        await harness.callHook('agent_end', { willContinue: true }, context)
        await vi.advanceTimersByTimeAsync(1_000)

        expect(postedHookNames(harness.fetchMock)).toEqual(['agent_start'])
        expect(context.isIdle).not.toHaveBeenCalled()
        expect(vi.getTimerCount()).toBe(0)
      } finally {
        vi.useRealTimers()
      }
    }
  )

  it.each(OMP_RUNTIME_CASES)(
    'settles a completed %s turn without waiting for ctx.isIdle',
    async (_name, args) => {
      // Why: absent payload and absent flag are both terminal for a version that cannot send one.
      for (const event of [{ willContinue: false }, {}, undefined]) {
        const harness = createAgentStatusExtensionHarness(args)
        const context = { isIdle: vi.fn(() => false) }

        await harness.callHook('agent_start')
        await harness.callHook('agent_end', event, context)

        await vi.waitFor(() =>
          expect(postedHookNames(harness.fetchMock)).toEqual(['agent_start', 'agent_end'])
        )
        expect(context.isIdle).not.toHaveBeenCalled()
      }
    }
  )

  it('settles a later terminal OMP agent_end after a continuation', async () => {
    const harness = createAgentStatusExtensionHarness({ kind: 'omp' })
    const context = { isIdle: vi.fn(() => false) }

    await harness.callHook('agent_start')
    await harness.callHook('agent_end', { willContinue: true }, context)
    expect(postedHookNames(harness.fetchMock)).toEqual(['agent_start'])

    await harness.callHook('agent_end', { willContinue: false }, context)
    await vi.waitFor(() =>
      expect(postedHookNames(harness.fetchMock)).toEqual(['agent_start', 'agent_end'])
    )
  })

  it('does not apply the OMP contract to Pi or Prime', async () => {
    vi.useFakeTimers()
    try {
      for (const kind of ['pi', 'prime-agent'] as const) {
        const harness = createAgentStatusExtensionHarness({ kind })
        const context = { isIdle: vi.fn(() => false) }

        await harness.callHook('agent_end', { willContinue: false }, context)
        await vi.advanceTimersByTimeAsync(1_000)

        expect(postedHookNames(harness.fetchMock)).toEqual([])
        expect(context.isIdle).toHaveBeenCalled()
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('preserves non-terminal agent_end handling for Pi and Prime', async () => {
    vi.useFakeTimers()
    try {
      for (const kind of ['pi', 'prime-agent'] as const) {
        const harness = createAgentStatusExtensionHarness({ kind })
        const context = { isIdle: vi.fn(() => true) }

        await harness.callHook('agent_end', { willContinue: true }, context)
        await vi.advanceTimersByTimeAsync(1_000)

        expect(postedHookNames(harness.fetchMock)).toEqual([])
        expect(context.isIdle).not.toHaveBeenCalled()
      }
    } finally {
      vi.useRealTimers()
    }
  })

  describe('OMP in-process subagents', () => {
    const PARENT_SESSION_DIR =
      '/home/u/.omp/agent/sessions/-GitHub-orca/2026-09-02T01-39-16-093Z_01a05fc5-39fd-74e9-bf37-729832f2f0da'
    const leadContext = {
      hasUI: true,
      sessionManager: {
        getSessionId: () => 'lead-session',
        getSessionFile: () => `${PARENT_SESSION_DIR}.jsonl`
      }
    }
    const subagentContext = {
      hasUI: false,
      sessionManager: {
        getSessionId: () => 'sub-session',
        getSessionFile: () => `${PARENT_SESSION_DIR}/Reviewer.jsonl`
      }
    }

    function postedPayloads(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown>[] {
      return fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).payload)
    }

    it.each(OMP_RUNTIME_CASES)(
      'reports a %s subagent runner on its own channel without touching the lead',
      async (_name, args) => {
        const harness = createAgentStatusExtensionHarness(args)

        await harness.callHook('agent_start', undefined, leadContext)
        await harness.callHook('agent_start', undefined, subagentContext)
        await harness.callHook(
          'tool_call',
          { toolName: 'bash', input: { command: 'ls' } },
          subagentContext
        )
        await harness.callHook(
          'message_end',
          { message: { role: 'assistant', content: 'hi' } },
          subagentContext
        )
        await harness.callHook('agent_end', { willContinue: true }, subagentContext)
        await harness.callHook('agent_end', { willContinue: false }, subagentContext)
        await harness.callHook('agent_end', { willContinue: false }, subagentContext)
        await harness.callHook('agent_end', { willContinue: false }, leadContext)

        expect(postedPayloads(harness.fetchMock)).toEqual([
          { hook_event_name: 'agent_start', session_id: 'lead-session' },
          {
            hook_event_name: 'subagent_start',
            subagent_id: 'sub-session',
            subagent_label: 'Reviewer'
          },
          {
            hook_event_name: 'subagent_end',
            subagent_id: 'sub-session',
            subagent_label: 'Reviewer'
          },
          { hook_event_name: 'agent_end', session_id: 'lead-session' }
        ])
      }
    )

    it('recognizes a Windows subagent transcript path', async () => {
      const harness = createAgentStatusExtensionHarness({ kind: 'omp' })

      await harness.callHook('agent_start', undefined, {
        hasUI: false,
        sessionManager: {
          getSessionId: () => 'sub-win',
          getSessionFile: () =>
            'C:\\Users\\u\\.omp\\agent\\sessions\\-GitHub-orca\\2026-09-02T01-39-16-093Z_01a05fc5-39fd-74e9-bf37-729832f2f0da\\Fixer.jsonl'
        }
      })

      expect(postedPayloads(harness.fetchMock)).toEqual([
        { hook_event_name: 'subagent_start', subagent_id: 'sub-win', subagent_label: 'Fixer' }
      ])
    })

    it('keeps reporting a headless top-level OMP run as the lead', async () => {
      // Why: `omp -p` has no UI either; only a transcript nested in a session directory marks a child.
      const harness = createAgentStatusExtensionHarness({ kind: 'omp' })

      await harness.callHook(
        'agent_end',
        { willContinue: false },
        {
          hasUI: false,
          sessionManager: {
            getSessionId: () => 'print-session',
            getSessionFile: () => `${PARENT_SESSION_DIR}.jsonl`
          }
        }
      )

      expect(postedPayloads(harness.fetchMock)).toEqual([
        { hook_event_name: 'agent_end', session_id: 'print-session' }
      ])
    })

    it('never lets a subagent post displace the pending lead post', async () => {
      const finishDeliveries: (() => void)[] = []
      const harness = createAgentStatusExtensionHarness({
        kind: 'omp',
        fetchImpl: vi.fn(
          () =>
            new Promise((resolve) => {
              finishDeliveries.push(() => resolve({ ok: true }))
            })
        )
      })

      await harness.callHook('agent_start', undefined, leadContext)
      await harness.callHook('agent_start', undefined, subagentContext)
      await harness.callHook('agent_end', { willContinue: false }, leadContext)
      finishDeliveries[0]?.()
      await vi.waitFor(() => expect(harness.fetchMock).toHaveBeenCalledTimes(2))
      finishDeliveries[1]?.()
      await vi.waitFor(() => expect(harness.fetchMock).toHaveBeenCalledTimes(3))
      finishDeliveries[2]?.()

      expect(postedHookNames(harness.fetchMock)).toEqual([
        'agent_start',
        'agent_end',
        'subagent_start'
      ])
    })
  })
})
