import { afterEach, describe, expect, it, vi } from 'vitest'

const { platformMock } = vi.hoisted(() => ({ platformMock: vi.fn(() => 'darwin') }))

vi.mock('@/lib/renderer-app-platform', () => ({ getRendererAppPlatform: platformMock }))

import { resolveDataStudioTabCreateGate } from './data-studio-tab-create-gate'

const ENABLED_INPUT = {
  terminalOnly: false,
  isLocalWorktree: true,
  hasRepoId: true,
  hasCreateCallback: true
}

describe('resolveDataStudioTabCreateGate', () => {
  afterEach(() => {
    platformMock.mockReset()
    platformMock.mockReturnValue('darwin')
  })

  it('enables on mac/linux local repo-backed workspaces with a callback', () => {
    expect(resolveDataStudioTabCreateGate(ENABLED_INPUT)).toEqual({
      hasNewDataStudio: true,
      dataStudioRemoteDisabled: false
    })
    platformMock.mockReturnValue('linux')
    expect(resolveDataStudioTabCreateGate(ENABLED_INPUT).hasNewDataStudio).toBe(true)
  })

  it('shows a disabled entry (not the enabled one) for remote worktrees', () => {
    expect(resolveDataStudioTabCreateGate({ ...ENABLED_INPUT, isLocalWorktree: false })).toEqual({
      hasNewDataStudio: false,
      dataStudioRemoteDisabled: true
    })
  })

  it('enables on Windows (the ADS server ships a win32-x64 artifact)', () => {
    platformMock.mockReturnValue('win32')
    expect(resolveDataStudioTabCreateGate(ENABLED_INPUT)).toEqual({
      hasNewDataStudio: true,
      dataStudioRemoteDisabled: false
    })
  })

  it('hides both entries when the workspace has no repo id (group folder workspaces)', () => {
    expect(resolveDataStudioTabCreateGate({ ...ENABLED_INPUT, hasRepoId: false })).toEqual({
      hasNewDataStudio: false,
      dataStudioRemoteDisabled: false
    })
  })

  it('hides both entries for terminal-only surfaces and missing callbacks', () => {
    expect(
      resolveDataStudioTabCreateGate({ ...ENABLED_INPUT, terminalOnly: true }).hasNewDataStudio
    ).toBe(false)
    expect(
      resolveDataStudioTabCreateGate({ ...ENABLED_INPUT, hasCreateCallback: false })
        .hasNewDataStudio
    ).toBe(false)
  })
})
