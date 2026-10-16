import { describe, expect, it } from 'vitest'
import { summarizeLongFrame } from './long-frame-diagnostic'

function frame(overrides: Record<string, unknown> = {}): PerformanceEntry {
  return {
    name: 'long-animation-frame',
    entryType: 'long-animation-frame',
    startTime: 5_000,
    duration: 900,
    toJSON: () => ({}),
    ...overrides
  } as PerformanceEntry
}

describe('summarizeLongFrame', () => {
  it('attributes the frame to its longest script and the last worktree switch', () => {
    const summary = summarizeLongFrame(
      frame({
        blockingDuration: 850,
        renderStart: 5_700,
        scripts: [
          { duration: 120, invoker: 'TimerHandler:setTimeout', sourceURL: 'file:///a/b/x.js' },
          {
            duration: 540,
            invoker: 'Response.json.then',
            invokerType: 'resolve-promise',
            sourceURL: 'file:///C:/Users/me/Orca/resources/app.asar/out/renderer/index-abc.js',
            sourceFunctionName: 'restoreLayout',
            sourceCharPosition: 1234,
            forcedStyleAndLayoutDuration: 80
          }
        ]
      }),
      4_800
    )
    expect(summary).toMatchObject({
      durationMs: 900,
      blockingMs: 850,
      scriptMs: 660,
      renderMs: 200,
      scriptCount: 2,
      topScriptMs: 540,
      topScriptInvokerType: 'resolve-promise',
      topScriptFunction: 'restoreLayout',
      topScriptSource: 'index-abc.js',
      topScriptCharPosition: 1234,
      topScriptForcedLayoutMs: 80,
      msSinceWorktreeSwitch: 200
    })
  })

  it('handles longtask entries without script attribution or a prior switch', () => {
    const summary = summarizeLongFrame(frame({ entryType: 'longtask' }), null)
    expect(summary).toMatchObject({
      entryType: 'longtask',
      blockingMs: null,
      renderMs: null,
      scriptCount: 0,
      topScriptFunction: null,
      msSinceWorktreeSwitch: null
    })
  })

  it('ignores a switch that happened after the frame started', () => {
    expect(summarizeLongFrame(frame(), 6_000).msSinceWorktreeSwitch).toBeNull()
  })
})
