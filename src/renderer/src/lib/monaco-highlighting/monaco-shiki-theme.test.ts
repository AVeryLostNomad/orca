import { describe, expect, it } from 'vitest'
import type { ThemeRegistrationResolved } from '@shikijs/core'
import {
  colorStyleKey,
  convertShikiThemeToMonaco,
  normalizeThemeColor,
  normalizeThemeFontStyle
} from './monaco-shiki-theme'

function resolvedTheme(
  overrides: Partial<ThemeRegistrationResolved> = {}
): ThemeRegistrationResolved {
  return {
    name: 'test-theme',
    type: 'dark',
    settings: [
      { settings: { foreground: '#ABCDEF', background: '#101010' } },
      { scope: 'comment', settings: { foreground: '#6a9955', fontStyle: 'italic' } },
      { scope: ['string', 'string.template'], settings: { foreground: '#CE9178' } },
      { scope: 'entity.name.function', settings: { foreground: '#dcdcaa' } },
      { scope: 'keyword.control', settings: { foreground: '#C586C0' } },
      { scope: 'nothing.here', settings: {} }
    ],
    fg: '#abcdef',
    bg: '#101010',
    ...overrides
  } as ThemeRegistrationResolved
}

describe('normalizeThemeColor', () => {
  it('lowercases, strips #, and expands shorthand', () => {
    expect(normalizeThemeColor('#ABCDEF')).toBe('abcdef')
    expect(normalizeThemeColor('abc')).toBe('aabbcc')
    expect(normalizeThemeColor('#abcd')).toBe('aabbccdd')
    expect(normalizeThemeColor(['#FFF', '#000'])).toBe('ffffff')
    expect(normalizeThemeColor(undefined)).toBeUndefined()
    expect(normalizeThemeColor('')).toBeUndefined()
  })
})

describe('normalizeThemeFontStyle', () => {
  it('orders, dedupes, and drops unknown styles', () => {
    expect(normalizeThemeFontStyle('bold italic')).toBe('italic bold')
    expect(normalizeThemeFontStyle('line-through')).toBe('strikethrough')
    expect(normalizeThemeFontStyle('normal')).toBe('')
    expect(normalizeThemeFontStyle(undefined)).toBe('')
  })
})

describe('colorStyleKey', () => {
  it('keys by color alone when unstyled', () => {
    expect(colorStyleKey('ffffff', '')).toBe('ffffff')
    expect(colorStyleKey('ffffff', 'italic')).toBe('ffffff|italic')
  })
})

describe('convertShikiThemeToMonaco', () => {
  it('maps scoped settings to rules and expands scope arrays', () => {
    const converted = convertShikiThemeToMonaco(resolvedTheme())
    expect(converted.base).toBe('vs-dark')
    expect(converted.inherit).toBe(false)
    const commentRule = converted.rules.find((rule) => rule.token === 'comment')
    expect(commentRule).toMatchObject({ foreground: '6a9955', fontStyle: 'italic' })
    expect(converted.rules.some((rule) => rule.token === 'string')).toBe(true)
    expect(converted.rules.some((rule) => rule.token === 'string.template')).toBe(true)
    expect(converted.rules.some((rule) => rule.token === 'nothing.here')).toBe(false)
  })

  it('backfills editor colors from the global setting when absent', () => {
    const converted = convertShikiThemeToMonaco(resolvedTheme())
    expect(converted.colors['editor.background']).toBe('#101010')
    expect(converted.colors['editor.foreground']).toBe('#abcdef')
  })

  it('prefers explicit theme colors over the global backfill', () => {
    const converted = convertShikiThemeToMonaco(
      resolvedTheme({ colors: { 'editor.background': '#222222' } })
    )
    expect(converted.colors['editor.background']).toBe('#222222')
  })

  it('synthesizes semantic token rules from representative scopes', () => {
    const converted = convertShikiThemeToMonaco(resolvedTheme())
    const functionRule = converted.rules.find((rule) => rule.token === 'function')
    expect(functionRule?.foreground).toBe('dcdcaa')
    const keywordRule = converted.rules.find((rule) => rule.token === 'keyword')
    expect(keywordRule?.foreground).toBe('c586c0')
    const commentSemanticRule = converted.rules.find(
      (rule) => rule.token === 'comment' && rule.fontStyle === 'italic'
    )
    expect(commentSemanticRule).toBeDefined()
  })

  it('uses vs base for light themes', () => {
    const converted = convertShikiThemeToMonaco(resolvedTheme({ type: 'light' }))
    expect(converted.base).toBe('vs')
  })
})
