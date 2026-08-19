import { describe, expect, it } from 'vitest'

import { shouldShowQuickAiRow, type QuickAiMatchCounts } from './quick-ai'

const EMPTY: QuickAiMatchCounts = {
  worktrees: 0,
  openTabs: 0,
  middle: 0,
  projectTargets: 0,
  files: 0
}

describe('shouldShowQuickAiRow', () => {
  it('shows only when a real query matched nothing at all', () => {
    expect(
      shouldShowQuickAiRow({
        query: 'why is my dev server crashing',
        matchCounts: EMPTY,
        hasUrlIntent: false,
        eligible: true
      })
    ).toBe(true)
  })

  it('hides when any section has a match', () => {
    for (const key of Object.keys(EMPTY) as (keyof QuickAiMatchCounts)[]) {
      expect(
        shouldShowQuickAiRow({
          query: 'some question',
          matchCounts: { ...EMPTY, [key]: 1 },
          hasUrlIntent: false,
          eligible: true
        })
      ).toBe(false)
    }
  })

  it('hides for short queries, URL intents, and ineligible workspaces', () => {
    expect(
      shouldShowQuickAiRow({ query: 'a', matchCounts: EMPTY, hasUrlIntent: false, eligible: true })
    ).toBe(false)
    expect(
      shouldShowQuickAiRow({ query: '  ', matchCounts: EMPTY, hasUrlIntent: false, eligible: true })
    ).toBe(false)
    expect(
      shouldShowQuickAiRow({
        query: 'https://github.com/o/r/pull/1',
        matchCounts: EMPTY,
        hasUrlIntent: true,
        eligible: true
      })
    ).toBe(false)
    expect(
      shouldShowQuickAiRow({
        query: 'question',
        matchCounts: EMPTY,
        hasUrlIntent: false,
        eligible: false
      })
    ).toBe(false)
  })
})
