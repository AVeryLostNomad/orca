import { describe, expect, it } from 'vitest'
import { resolveHttpLinkBrowserPlacement } from './http-link-browser-placement'

const WT = 'wt-1'
const terminal = { id: 'term', contentType: 'terminal' } as const
const browser = { id: 'browser', contentType: 'browser' } as const
const split = {
  type: 'split',
  direction: 'horizontal',
  first: { type: 'leaf', groupId: 'left' },
  second: { type: 'leaf', groupId: 'right' }
} as const

function state(overrides: {
  rightActiveTabId: string
  activeGroupId: string
  tabs?: { id: string; contentType: 'terminal' | 'browser' | 'editor' }[]
  besideSource?: boolean
}): Parameters<typeof resolveHttpLinkBrowserPlacement>[0] {
  return {
    layoutByWorktree: { [WT]: split },
    activeGroupIdByWorktree: { [WT]: overrides.activeGroupId },
    groupsByWorktree: {
      [WT]: [
        { id: 'left', activeTabId: 'term' },
        { id: 'right', activeTabId: overrides.rightActiveTabId }
      ]
    },
    unifiedTabsByWorktree: { [WT]: overrides.tabs ?? [terminal, browser] },
    settings: { openLinksInAppBesideSource: overrides.besideSource }
  }
}

describe('resolveHttpLinkBrowserPlacement', () => {
  it('adds the link to a browser already on screen, whichever pane the link came from', () => {
    expect(
      resolveHttpLinkBrowserPlacement(
        state({ rightActiveTabId: 'browser', activeGroupId: 'left' }),
        WT
      )
    ).toEqual({ targetGroupId: 'right' })
    expect(
      resolveHttpLinkBrowserPlacement(
        state({ rightActiveTabId: 'browser', activeGroupId: 'right' }),
        WT
      )
    ).toEqual({ targetGroupId: 'right' })
  })

  it('ignores a browser hidden behind another tab, opening a tab in the source unless splits are enabled', () => {
    const editor = { id: 'editor', contentType: 'editor' } as const
    const hidden = {
      rightActiveTabId: 'editor',
      activeGroupId: 'left',
      tabs: [terminal, browser, editor]
    }
    expect(resolveHttpLinkBrowserPlacement(state(hidden), WT)).toEqual({ targetGroupId: 'left' })
    expect(resolveHttpLinkBrowserPlacement(state({ ...hidden, besideSource: true }), WT)).toEqual({
      split: { sourceGroupId: 'left', splitDirection: 'right', activate: false }
    })
  })

  it('fills an empty source pane rather than splitting beside it', () => {
    expect(
      resolveHttpLinkBrowserPlacement(
        state({ rightActiveTabId: '', activeGroupId: 'right', tabs: [terminal] }),
        WT
      )
    ).toEqual({ targetGroupId: 'right' })
  })
})
