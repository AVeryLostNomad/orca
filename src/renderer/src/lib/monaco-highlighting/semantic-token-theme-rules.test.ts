import { describe, expect, it } from 'vitest'
import type { ThemeRegistrationResolved } from '@shikijs/core'
import { synthesizeSemanticTokenThemeRules } from './semantic-token-theme-rules'
import { normalizeThemeColor, normalizeThemeFontStyle } from './monaco-shiki-theme'

function themeWith(
  semanticTokenColors: Record<string, unknown> | undefined,
  settings: ThemeRegistrationResolved['settings'] = []
): ThemeRegistrationResolved {
  return {
    name: 'test-theme',
    type: 'dark',
    settings,
    fg: '#cdd6f4',
    bg: '#1e1e2e',
    semanticTokenColors
  } as ThemeRegistrationResolved
}

function synthesize(theme: ThemeRegistrationResolved) {
  return synthesizeSemanticTokenThemeRules(theme, normalizeThemeColor, normalizeThemeFontStyle)
}

describe('synthesizeSemanticTokenThemeRules', () => {
  it('emits unqualified semanticTokenColors entries for string and object values', () => {
    const rules = synthesize(
      themeWith({
        boolean: { foreground: '#fab387' },
        heading: '#f38ba8'
      })
    )
    expect(rules).toContainEqual({ token: 'boolean', foreground: 'fab387', fontStyle: undefined })
    expect(rules).toContainEqual({ token: 'heading', foreground: 'f38ba8', fontStyle: undefined })
  })

  it('keeps modifier chains as dotted Monaco tokens', () => {
    const rules = synthesize(themeWith({ 'variable.defaultLibrary': { foreground: '#eba0ac' } }))
    expect(rules).toContainEqual({
      token: 'variable.defaultLibrary',
      foreground: 'eba0ac',
      fontStyle: undefined
    })
  })

  it('globalizes language-qualified entries that carry modifiers', () => {
    const rules = synthesize(
      themeWith({
        'type.defaultLibrary:go': { foreground: '#cba6f7' },
        'variable.readonly.defaultLibrary:go': { foreground: '#cba6f7' }
      })
    )
    expect(rules).toContainEqual({
      token: 'type.defaultLibrary',
      foreground: 'cba6f7',
      fontStyle: undefined
    })
    expect(rules).toContainEqual({
      token: 'variable.readonly.defaultLibrary',
      foreground: 'cba6f7',
      fontStyle: undefined
    })
  })

  it('skips bare language-qualified entries — globalizing them would restyle every language', () => {
    const rules = synthesize(themeWith({ 'interface:haskell': { foreground: '#f5c2e7' } }))
    expect(rules.some((rule) => rule.token === 'interface')).toBe(false)
  })

  it('prefers an unqualified entry over language-qualified ones for the same token', () => {
    const rules = synthesize(
      themeWith({
        'property.readonly:typescript': { foreground: '#cdd6f4' },
        'property.readonly': { foreground: '#89b4fa' }
      })
    )
    const matching = rules.filter((rule) => rule.token === 'property.readonly')
    expect(matching).toEqual([
      { token: 'property.readonly', foreground: '89b4fa', fontStyle: undefined }
    ])
  })

  it('picks a deterministic winner among same-token entries from different languages', () => {
    const rules = synthesize(
      themeWith({
        'variable.readonly:scala': { foreground: '#111111' },
        'variable.readonly:javascript': { foreground: '#222222' }
      })
    )
    const matching = rules.filter((rule) => rule.token === 'variable.readonly')
    expect(matching).toEqual([
      { token: 'variable.readonly', foreground: '222222', fontStyle: undefined }
    ])
  })

  it('preserves an explicit empty fontStyle so Monaco clears inherited styles', () => {
    const rules = synthesize(themeWith({ tomlArrayKey: { foreground: '#89b4fa', fontStyle: '' } }))
    expect(rules).toContainEqual({ token: 'tomlArrayKey', foreground: '89b4fa', fontStyle: '' })
  })

  it('composes fontStyle from boolean style flags', () => {
    const rules = synthesize(themeWith({ 'text.strong': { bold: true, italic: true } }))
    expect(rules).toContainEqual({
      token: 'text.strong',
      foreground: undefined,
      fontStyle: 'italic bold'
    })
  })

  it('skips wildcard and malformed selectors', () => {
    const rules = synthesize(
      themeWith({
        '*.declaration': { foreground: '#ffffff' },
        '.readonly': { foreground: '#ffffff' },
        'a:b:c': { foreground: '#ffffff' }
      })
    )
    expect(rules).toHaveLength(0)
  })

  it('emits semanticTokenColors rules after scope-derived fallbacks so they win', () => {
    const rules = synthesize(
      themeWith({ type: { foreground: '#cba6f7' } }, [
        { scope: 'entity.name.type', settings: { foreground: '#f9e2af', fontStyle: 'italic' } }
      ])
    )
    const typeRules = rules.filter((rule) => rule.token === 'type')
    expect(typeRules.map((rule) => rule.foreground)).toEqual(['f9e2af', 'cba6f7'])
  })
})
