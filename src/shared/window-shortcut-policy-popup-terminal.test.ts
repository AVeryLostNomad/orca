import { describe, expect, it } from 'vitest'
import { resolveWindowShortcutAction } from './window-shortcut-policy'

describe('resolveWindowShortcutAction popup terminal', () => {
  it.each([
    ['darwin', true, false],
    ['linux', false, true],
    ['win32', false, true]
  ] as const)('resolves the popup terminal shortcut on %s', (platform, meta, control) => {
    expect(
      resolveWindowShortcutAction(
        {
          code: 'Space',
          key: ' ',
          meta,
          control,
          alt: false,
          shift: true
        },
        platform
      )
    ).toEqual({ type: 'togglePopupTerminal' })
  })
})
