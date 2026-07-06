import { describe, expect, it, vi } from 'vitest'
import type * as NodeFs from 'node:fs'

vi.mock('electron', () => ({ app: { getPath: () => '/userData' } }))
vi.mock('./code-server-installer', () => ({ ensureCodeServerInstalled: vi.fn() }))
vi.mock('./code-server-vscode-settings-link', () => ({ linkVsCodeUserSettings: vi.fn() }))
// Passthrough spread (not a full replacement) so vi.spyOn can patch individual
// fs functions below — a real ES module namespace object isn't spy-able.
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof NodeFs>()
  return { ...original }
})

import { buildCodeServerArgs, CodeServerManager } from './code-server-manager'

describe('buildCodeServerArgs', () => {
  it('binds loopback, disables auth+telemetry, isolates dirs', () => {
    expect(buildCodeServerArgs(12345)).toEqual([
      '--bind-addr',
      '127.0.0.1:12345',
      '--auth',
      'none',
      '--disable-telemetry',
      '--user-data-dir',
      '/userData/code-server/user-data',
      '--extensions-dir',
      '/userData/code-server/extensions'
    ])
  })
})

describe('reapOrphan', () => {
  it('sends SIGTERM to a stale pid and removes the pidfile', async () => {
    const fs = await import('node:fs')
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'readFileSync').mockReturnValue('4242')
    const rmSpy = vi.spyOn(fs, 'rmSync').mockImplementation(() => {})
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    new CodeServerManager().reapOrphan()
    expect(killSpy).toHaveBeenCalledWith(4242, 'SIGTERM')
    expect(rmSpy).toHaveBeenCalled()
    killSpy.mockRestore()
  })
})
