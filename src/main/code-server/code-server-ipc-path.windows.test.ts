import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/userData') } }))

import { getCodeServerSessionSocketPath } from './code-server-ipc-path'

describe('code-server session socket path', () => {
  it('is a filesystem socket under user-data on posix', () => {
    expect(getCodeServerSessionSocketPath('linux', '/ud')).toBe('/ud/code-server-ipc.sock')
  })

  it('is a named pipe on win32', () => {
    expect(getCodeServerSessionSocketPath('win32', 'C:\\ud')).toMatch(
      /^\\\\\.\\pipe\\orca-code-server-ipc-[0-9a-f]{12}$/
    )
  })

  it('is deterministic per profile and distinct across profiles', () => {
    const a = getCodeServerSessionSocketPath('win32', 'C:\\Users\\a\\AppData\\Roaming\\Orca')
    const b = getCodeServerSessionSocketPath('win32', 'C:\\Users\\b\\AppData\\Roaming\\Orca')
    expect(a).toBe(getCodeServerSessionSocketPath('win32', 'C:\\Users\\a\\AppData\\Roaming\\Orca'))
    expect(a).not.toBe(b)
  })
})
