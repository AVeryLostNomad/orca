import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import { _resetTracerForTests, setActiveSink, type TracerSink } from './tracer'
import { publishSystemResume, publishSystemSuspend } from '../system-power-lifecycle'
import {
  MAIN_THREAD_STALL_THRESHOLD_MS,
  measureTimerStallMs,
  recordSlowMainOperation,
  recordSlowSpawn,
  startMainThreadStallMonitor,
  stopMainThreadStallMonitor,
  watchWindowResponsiveness
} from './main-thread-stall-monitor'

type SpanRecord = { name: string; attributes: Record<string, unknown> }

let records: SpanRecord[]

beforeEach(() => {
  records = []
  const sink: TracerSink = {
    push: (record) => records.push(record as SpanRecord),
    flush: () => {},
    close: () => {}
  }
  setActiveSink(sink)
})

afterEach(() => {
  stopMainThreadStallMonitor()
  _resetTracerForTests()
  vi.useRealTimers()
})

describe('measureTimerStallMs', () => {
  it('reports only the lateness beyond the tick interval', () => {
    expect(measureTimerStallMs(1000, 1100)).toBe(0)
    expect(measureTimerStallMs(1000, 1050)).toBe(0)
    expect(measureTimerStallMs(1000, 1600)).toBe(500)
  })
})

describe('recordSlowMainOperation', () => {
  it('skips operations under the threshold', () => {
    recordSlowMainOperation('fast', performance.now())
    expect(records).toHaveLength(0)
  })

  it('records operations at or over the threshold', () => {
    recordSlowMainOperation('slow', performance.now() - MAIN_THREAD_STALL_THRESHOLD_MS - 5, {
      bytes: 42
    })
    expect(records).toHaveLength(1)
    expect(records[0].name).toBe('main.slow_operation.slow')
    expect(records[0].attributes.bytes).toBe(42)
    expect(records[0].attributes.durationMs).toBeGreaterThanOrEqual(MAIN_THREAD_STALL_THRESHOLD_MS)
  })
})

describe('startMainThreadStallMonitor', () => {
  it('records a span when the timer fires late by more than the threshold', () => {
    vi.useFakeTimers()
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    startMainThreadStallMonitor()
    now = 100
    vi.advanceTimersByTime(100)
    expect(records).toHaveLength(0)
    now = 100 + 100 + 750
    vi.advanceTimersByTime(100)
    expect(records).toHaveLength(1)
    expect(records[0].name).toBe('main.event_loop_stall')
    expect(records[0].attributes.stallMs).toBe(750)
  })
})

describe('recordSlowSpawn', () => {
  it('ignores spawns under the threshold', () => {
    recordSlowSpawn({ command: 'git', args: ['status'], blockMs: 5, sync: false, timedOut: false })
    expect(records).toHaveLength(0)
  })

  it('records a slow spawn and whether uv_spawn had to search PATH', () => {
    recordSlowSpawn({
      command: 'git',
      args: ['-c', 'core.quotepath=false', 'status'],
      blockMs: 5004.6,
      sync: false,
      timedOut: false
    })
    recordSlowSpawn({
      command: 'C:\\Windows\\System32\\whoami.exe',
      args: ['/user'],
      blockMs: 5000,
      sync: true,
      timedOut: true
    })
    expect(records.map((record) => record.attributes)).toEqual([
      {
        command: 'git status',
        binaryIsAbsolute: false,
        sync: false,
        timedOut: false,
        blockMs: 5005
      },
      { command: 'whoami', binaryIsAbsolute: true, sync: true, timedOut: true, blockMs: 5000 }
    ])
  })
})

describe('stall attribution', () => {
  function stallAfter(blockMs: number, during: () => void): Record<string, unknown> {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    startMainThreadStallMonitor()
    vi.setSystemTime(1_000_000 + blockMs)
    during()
    now = 100 + blockMs
    vi.advanceTimersByTime(100)
    const stall = records.find((record) => record.name === 'main.event_loop_stall')
    expect(stall).toBeDefined()
    return stall!.attributes
  }

  it('names the slow spawn that caused the stall', () => {
    const attributes = stallAfter(5000, () =>
      recordSlowSpawn({
        command: 'git',
        args: ['diff'],
        blockMs: 4990,
        sync: false,
        timedOut: false
      })
    )
    expect(attributes).toMatchObject({ slowSpawn: 'git diff', slowSpawnBlockMs: 4990 })
    expect(attributes.systemSuspended).toBeUndefined()
  })

  it('marks a stall that spans a system suspend', () => {
    const attributes = stallAfter(60_000, () => publishSystemSuspend())
    publishSystemResume()
    expect(attributes).toMatchObject({ systemSuspended: true })
    expect(attributes.slowSpawn).toBeUndefined()
  })
})

describe('watchWindowResponsiveness', () => {
  it('records the unresponsive duration once the window recovers', () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    const window = new EventEmitter()
    watchWindowResponsiveness(window as unknown as BrowserWindow, 'main')
    window.emit('responsive')
    expect(records).toHaveLength(0)
    window.emit('unresponsive')
    vi.setSystemTime(13_500)
    window.emit('responsive')
    expect(records).toHaveLength(1)
    expect(records[0].name).toBe('renderer.unresponsive')
    expect(records[0].attributes).toMatchObject({ surface: 'main', unresponsiveMs: 3500 })
  })
})
