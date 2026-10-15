import { describe, expect, it } from 'vitest'
import { buildPopupTaskStartupCommand } from './terminal-quick-command-popup-exit'

describe('buildPopupTaskStartupCommand', () => {
  it('ends the shell with the task for each shell family', () => {
    expect(buildPopupTaskStartupCommand('pnpm build', 'posix')).toBe('pnpm build; exit')
    expect(buildPopupTaskStartupCommand('pnpm build', 'powershell')).toBe(
      'pnpm build; exit $LASTEXITCODE'
    )
    expect(buildPopupTaskStartupCommand('pnpm build', 'cmd')).toBe('pnpm build & exit')
  })

  it('drops trailing separators so the appended exit stays valid', () => {
    expect(buildPopupTaskStartupCommand('  pnpm lint; pnpm test;  ', 'posix')).toBe(
      'pnpm lint; pnpm test; exit'
    )
  })
})
