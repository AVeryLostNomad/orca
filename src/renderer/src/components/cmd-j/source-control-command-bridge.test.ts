import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  consumePendingSourceControlAction,
  hasPendingSourceControlAction,
  requestSourceControlAction,
  subscribePendingSourceControlAction
} from './source-control-command-bridge'

describe('source-control command bridge', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Drain any intent left over from another test.
    consumePendingSourceControlAction(null)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('hands the intent to the matching worktree exactly once', () => {
    requestSourceControlAction('push', 'wt-1')
    expect(hasPendingSourceControlAction()).toBe(true)
    expect(consumePendingSourceControlAction('wt-1')).toBe('push')
    expect(consumePendingSourceControlAction('wt-1')).toBeNull()
  })

  it('drops the intent when a different worktree tries to consume it', () => {
    requestSourceControlAction('create_pr', 'wt-1')
    expect(consumePendingSourceControlAction('wt-2')).toBeNull()
    // Why: a mismatched consume clears it — the panel that mounted is not the target.
    expect(hasPendingSourceControlAction()).toBe(false)
  })

  it('expires stale intents', () => {
    requestSourceControlAction('sync', 'wt-1')
    vi.advanceTimersByTime(11_000)
    expect(consumePendingSourceControlAction('wt-1')).toBeNull()
  })

  it('notifies subscribers when an intent arrives', () => {
    const listener = vi.fn()
    const unsubscribe = subscribePendingSourceControlAction(listener)
    requestSourceControlAction('pull', 'wt-1')
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    requestSourceControlAction('pull', 'wt-1')
    expect(listener).toHaveBeenCalledTimes(1)
    consumePendingSourceControlAction('wt-1')
  })
})
