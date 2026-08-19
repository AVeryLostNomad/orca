import { describe, expect, it } from 'vitest'

import { normalizeEditorFontSize } from './editor-font-size'

describe('normalizeEditorFontSize', () => {
  it('passes through in-range integers', () => {
    expect(normalizeEditorFontSize(14)).toBe(14)
  })

  it('rounds fractional values', () => {
    expect(normalizeEditorFontSize(14.6)).toBe(15)
  })

  it('clamps to the 8–32 safe range', () => {
    expect(normalizeEditorFontSize(4)).toBe(8)
    expect(normalizeEditorFontSize(100)).toBe(32)
  })

  it('collapses non-numeric or non-finite input to unset', () => {
    expect(normalizeEditorFontSize(undefined)).toBeUndefined()
    expect(normalizeEditorFontSize(null)).toBeUndefined()
    expect(normalizeEditorFontSize('14')).toBeUndefined()
    expect(normalizeEditorFontSize(Number.NaN)).toBeUndefined()
    expect(normalizeEditorFontSize(Number.POSITIVE_INFINITY)).toBeUndefined()
  })
})
