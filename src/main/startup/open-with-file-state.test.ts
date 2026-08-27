import { describe, expect, it, vi } from 'vitest'
import { OpenWithFileState } from './open-with-file-state'

describe('OpenWithFileState', () => {
  it('queues startup paths until the renderer consumes them once', () => {
    const state = new OpenWithFileState()

    expect(state.capture(['/tmp/report.sql'])).toBe(true)
    expect(state.capture(['/tmp/notes.md'])).toBe(true)
    expect(state.consume()).toEqual(['/tmp/report.sql', '/tmp/notes.md'])
    expect(state.consume()).toEqual([])
  })

  it('delivers live when publish succeeds and leaves nothing pending', () => {
    const state = new OpenWithFileState()
    const publish = vi.fn().mockReturnValue(true)

    expect(state.capture(['/tmp/query.sql'], publish)).toBe(true)
    expect(publish).toHaveBeenCalledWith(['/tmp/query.sql'])
    expect(state.consume()).toEqual([])
  })

  it('keeps paths pending when publish reports no live renderer', () => {
    const state = new OpenWithFileState()
    const publish = vi.fn().mockReturnValue(false)

    expect(state.capture(['/tmp/query.sql'], publish)).toBe(true)
    expect(state.consume()).toEqual(['/tmp/query.sql'])
  })

  it('extracts only association-matching absolute paths from argv', () => {
    const state = new OpenWithFileState()

    expect(
      state.captureFromArgv([
        '/Applications/Orca.app/Contents/MacOS/Orca',
        '--no-sandbox',
        'orca://skills/share/share_x',
        'relative.sql',
        '/Users/me/Downloads/report.sql',
        'C:\\Users\\me\\query.SQL',
        '/Users/me/binary.exe'
      ])
    ).toBe(true)
    expect(state.consume()).toEqual(['/Users/me/Downloads/report.sql', 'C:\\Users\\me\\query.SQL'])
  })

  it('reports false when argv holds no openable files', () => {
    const state = new OpenWithFileState()
    expect(state.captureFromArgv(['/usr/bin/orca-ide', '--flag'])).toBe(false)
  })
})
