import { describe, expect, it } from 'vitest'
import type { PaneUsageSnapshot } from '../../../../shared/pane-usage-types'
import { resolveFocusedPaneUsage } from './focused-pane-usage'

const snapshot: PaneUsageSnapshot = {
  paneKey: 'tab:leaf',
  agent: 'omp',
  updatedAt: 1,
  session: null,
  accounts: [
    {
      provider: 'zai',
      label: null,
      active: false,
      limits: [{ id: 'z', label: 'Z', usedPercent: 5, windowMinutes: 300, resetsAt: null }]
    },
    {
      provider: 'openai-codex',
      label: 'b@x',
      active: false,
      limits: [{ id: 'c', label: '5h', usedPercent: 10, windowMinutes: 300, resetsAt: null }]
    },
    {
      provider: 'anthropic',
      label: 'a@x',
      active: true,
      limits: [
        { id: 'w', label: '7d', usedPercent: 40, windowMinutes: 10_000, resetsAt: 9 },
        { id: 's', label: '5h', usedPercent: 120, windowMinutes: 290, resetsAt: null },
        { id: 'o', label: 'Opus', usedPercent: 3, windowMinutes: 10_080, resetsAt: null },
        { id: 'm', label: 'Month', usedPercent: 7, windowMinutes: null, resetsAt: null }
      ]
    }
  ]
}

describe('resolveFocusedPaneUsage', () => {
  it('returns null when the pane now runs a different agent', () => {
    expect(resolveFocusedPaneUsage({ paneUsage: [snapshot] }, 'tab:leaf', 'claude')).toBeNull()
    expect(resolveFocusedPaneUsage({ paneUsage: [snapshot] }, 'other', 'omp')).toBeNull()
  })

  it('maps accounts active-first and classifies windows with tolerance', () => {
    const result = resolveFocusedPaneUsage({ paneUsage: [snapshot] }, 'tab:leaf', 'omp')
    expect(result?.providers.map((p) => p.provider)).toEqual(['claude', 'codex'])
    const claude = result?.providers[0]
    expect(claude?.session).toMatchObject({ usedPercent: 100, windowMinutes: 300 })
    expect(claude?.weekly).toMatchObject({ usedPercent: 40, windowMinutes: 10_080, resetsAt: 9 })
    expect(claude?.monthly).toBeNull()
    expect(claude?.buckets?.map((b) => b.name)).toEqual(['Opus', 'Month'])
    expect(result?.otherAccounts.map((a) => a.provider)).toEqual(['zai'])
  })
})
