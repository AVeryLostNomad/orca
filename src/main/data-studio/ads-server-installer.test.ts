import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/userData') },
  net: { request: vi.fn() }
}))

import { tarExecutable } from './ads-server-installer'

describe('tarExecutable', () => {
  // PATH tar on Windows can be Git for Windows' GNU tar, which parses C:\...
  // as remote host "C" ("Cannot connect to C: resolve failed").
  it('uses System32 bsdtar by absolute path on Windows', () => {
    expect(tarExecutable('win32', { SystemRoot: 'D:\\Windows' })).toBe(
      join('D:\\Windows', 'System32', 'tar.exe')
    )
    expect(tarExecutable('win32', {})).toBe(join('C:\\Windows', 'System32', 'tar.exe'))
  })

  it('uses PATH tar on POSIX', () => {
    expect(tarExecutable('darwin', {})).toBe('tar')
    expect(tarExecutable('linux', {})).toBe('tar')
  })
})
