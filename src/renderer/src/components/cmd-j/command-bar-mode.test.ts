import { describe, expect, it } from 'vitest'

import { parseCommandBarMode } from './command-bar-mode'

describe('parseCommandBarMode', () => {
  it('returns files mode only for the explicit marker', () => {
    expect(parseCommandBarMode({ paletteMode: 'files' })).toBe('files')
  })

  it('defaults to all for missing or unknown data', () => {
    expect(parseCommandBarMode(null)).toBe('all')
    expect(parseCommandBarMode({})).toBe('all')
    expect(parseCommandBarMode({ paletteMode: 'bogus' })).toBe('all')
    expect(parseCommandBarMode({ other: true })).toBe('all')
  })
})
