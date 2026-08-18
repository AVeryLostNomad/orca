import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/userData') } }))

import { toFileOpenUri } from './code-server-open-file'

describe('toFileOpenUri', () => {
  it('converts a backslash drive path to a file URI', () => {
    expect(toFileOpenUri('C:\\Users\\joey\\wt\\src\\foo.ts', 'win32')).toBe(
      'file:///C:/Users/joey/wt/src/foo.ts'
    )
  })

  it('converts a forward-slash drive path to a file URI', () => {
    expect(toFileOpenUri('C:/Users/joey/wt/src/foo.ts', 'win32')).toBe(
      'file:///C:/Users/joey/wt/src/foo.ts'
    )
  })

  it('maps a UNC path host to the URI authority', () => {
    expect(toFileOpenUri('\\\\wsl.localhost\\Ubuntu\\home\\joey\\wt\\foo.ts', 'win32')).toBe(
      'file://wsl.localhost/Ubuntu/home/joey/wt/foo.ts'
    )
  })

  it('keeps posix paths as plain file URIs', () => {
    expect(toFileOpenUri('/Users/joey/wt/src/foo.ts', 'darwin')).toBe(
      'file:///Users/joey/wt/src/foo.ts'
    )
  })

  it('encodes characters URI.parse would split or decode on', () => {
    expect(toFileOpenUri('C:\\wt\\a %?# b.ts', 'win32')).toBe('file:///C:/wt/a %25%3F%23 b.ts')
    expect(toFileOpenUri('/wt/a %?# b.ts', 'linux')).toBe('file:///wt/a %25%3F%23 b.ts')
  })
})
