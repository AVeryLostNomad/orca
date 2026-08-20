import type * as Monaco from 'monaco-editor'
import type { ThemeRegistrationResolved } from '@shikijs/core'

type ThemeTokenSetting = ThemeRegistrationResolved['settings'][number]

// Monaco standalone themes color LSP semantic tokens by rules keyed on the
// semantic token *type* (e.g. `function`), not TextMate scopes. A converted
// VS Code theme only has scope rules, so semantic tokens would fall back to
// the plain foreground. Synthesize one rule per semantic type by resolving a
// representative TextMate scope through the theme's own tokenColors.
const SEMANTIC_TOKEN_SCOPE_SOURCES: Record<string, string[]> = {
  namespace: ['entity.name.namespace', 'entity.name.type.namespace', 'entity.name.module'],
  type: ['entity.name.type', 'support.type'],
  class: ['entity.name.type.class', 'entity.name.class', 'support.class'],
  enum: ['entity.name.type.enum'],
  interface: ['entity.name.type.interface'],
  struct: ['entity.name.type.struct'],
  typeParameter: ['entity.name.type.parameter'],
  parameter: ['variable.parameter'],
  variable: ['variable.other.readwrite', 'variable.other', 'variable'],
  property: ['variable.other.property', 'support.type.property-name'],
  enumMember: ['variable.other.enummember', 'constant.other.enum'],
  event: ['variable.other.event'],
  function: ['entity.name.function', 'support.function'],
  method: ['entity.name.function.member', 'entity.name.function'],
  macro: ['entity.name.function.macro', 'entity.name.other.preprocessor.macro'],
  keyword: ['keyword.control', 'keyword'],
  comment: ['comment'],
  string: ['string'],
  number: ['constant.numeric'],
  regexp: ['string.regexp'],
  operator: ['keyword.operator'],
  decorator: ['entity.name.function.decorator', 'meta.decorator', 'punctuation.decorator']
}

function scopeSelectorMatches(selector: string, scope: string): boolean {
  return selector === scope || scope.startsWith(`${selector}.`)
}

type ResolvedScopeStyle = { foreground?: string; fontStyle?: string }

// Longest-selector match wins; on equal length the later rule wins, matching
// how VS Code resolves tokenColors. Descendant selectors (with spaces) are
// skipped — matching them needs full scope stacks we don't have here.
function resolveThemeStyleForScope(
  settings: ThemeTokenSetting[],
  scope: string
): ResolvedScopeStyle | undefined {
  let best: ResolvedScopeStyle | undefined
  let bestLength = -1
  for (const setting of settings) {
    if (!setting.scope || !setting.settings) {
      continue
    }
    const selectors = Array.isArray(setting.scope) ? setting.scope : [setting.scope]
    for (const rawSelector of selectors) {
      const selector = rawSelector.trim()
      if (!selector || selector.includes(' ')) {
        continue
      }
      if (!scopeSelectorMatches(selector, scope)) {
        continue
      }
      if (selector.length >= bestLength) {
        bestLength = selector.length
        best = {
          foreground: setting.settings.foreground,
          fontStyle: setting.settings.fontStyle
        }
      }
    }
  }
  return best?.foreground || best?.fontStyle ? best : undefined
}

// VS Code `semanticTokenColors` value: a color string or a style object.
type SemanticTokenStyleObject = {
  foreground?: string
  fontStyle?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
}
type SemanticTokenStyle = string | SemanticTokenStyleObject

// Shiki types semanticTokenColors as Record<string, string>, but real VS Code
// themes use style objects too.
type ThemeWithSemanticTokenColors = ThemeRegistrationResolved & {
  semanticTokenColors?: Record<string, SemanticTokenStyle>
}

const FONT_STYLE_FLAGS = ['italic', 'bold', 'underline', 'strikethrough'] as const

// `undefined` means "not specified" (Monaco inherits); `''` explicitly clears.
function fontStyleOfSemanticStyle(style: SemanticTokenStyle): string | undefined {
  if (typeof style === 'string') {
    return undefined
  }
  if (typeof style.fontStyle === 'string') {
    return style.fontStyle
  }
  const explicit = FONT_STYLE_FLAGS.some((flag) => typeof style[flag] === 'boolean')
  return explicit ? FONT_STYLE_FLAGS.filter((flag) => style[flag] === true).join(' ') : undefined
}

type ParsedSemanticSelector = { token: string; hasModifiers: boolean; language: string | undefined }

// Selector grammar: `type(.modifier)*(:language)?`.
function parseSemanticTokenSelector(selector: string): ParsedSemanticSelector | undefined {
  const colonParts = selector.split(':')
  if (colonParts.length > 2) {
    return undefined
  }
  const [key, language] = colonParts
  const parts = key.split('.').map((part) => part.trim())
  if (parts.some((part) => !part || part.includes('*'))) {
    return undefined
  }
  return { token: parts.join('.'), hasModifiers: parts.length > 1, language }
}

function semanticTokenRuleForStyle(
  token: string,
  style: SemanticTokenStyle,
  normalizeColor: (color: string | undefined) => string | undefined,
  normalizeFontStyle: (fontStyle: string | undefined) => string
): Monaco.editor.ITokenThemeRule | undefined {
  const foreground = normalizeColor(typeof style === 'string' ? style : style.foreground)
  const rawFontStyle = fontStyleOfSemanticStyle(style)
  const fontStyle = rawFontStyle === undefined ? undefined : normalizeFontStyle(rawFontStyle)
  if (foreground === undefined && fontStyle === undefined) {
    return undefined
  }
  return { token, foreground, fontStyle }
}

// Rules from the theme's own `semanticTokenColors`. Monaco's standalone theme
// matches semantic tokens as `type.modifier1.modifier2` with no language
// dimension, so `:language` selectors can't be honored per-language. Entries
// with modifiers (e.g. `type.defaultLibrary:go`) are specific enough to apply
// globally; bare `type:language` entries are skipped — globalizing them would
// restyle every language.
function semanticTokenColorRules(
  theme: ThemeRegistrationResolved,
  normalizeColor: (color: string | undefined) => string | undefined,
  normalizeFontStyle: (fontStyle: string | undefined) => string
): Monaco.editor.ITokenThemeRule[] {
  const semanticTokenColors = (theme as ThemeWithSemanticTokenColors).semanticTokenColors
  if (!semanticTokenColors) {
    return []
  }
  const rules: Monaco.editor.ITokenThemeRule[] = []
  const unqualifiedTokens = new Set<string>()
  const entries: { parsed: ParsedSemanticSelector; style: SemanticTokenStyle }[] = []
  for (const [selector, style] of Object.entries(semanticTokenColors)) {
    const parsed = parseSemanticTokenSelector(selector)
    if (parsed) {
      entries.push({ parsed, style })
    }
  }
  for (const { parsed, style } of entries) {
    if (parsed.language !== undefined) {
      continue
    }
    const rule = semanticTokenRuleForStyle(parsed.token, style, normalizeColor, normalizeFontStyle)
    if (rule) {
      rules.push(rule)
      unqualifiedTokens.add(parsed.token)
    }
  }
  // Sorted so the winner among same-token entries from different languages is
  // deterministic; an unqualified entry for the token always wins instead.
  const emittedQualified = new Set<string>()
  const qualified = entries
    .filter(({ parsed }) => parsed.language !== undefined && parsed.hasModifiers)
    .sort(
      (a, b) =>
        a.parsed.token.localeCompare(b.parsed.token) ||
        (a.parsed.language ?? '').localeCompare(b.parsed.language ?? '')
    )
  for (const { parsed, style } of qualified) {
    if (unqualifiedTokens.has(parsed.token) || emittedQualified.has(parsed.token)) {
      continue
    }
    const rule = semanticTokenRuleForStyle(parsed.token, style, normalizeColor, normalizeFontStyle)
    if (rule) {
      rules.push(rule)
      emittedQualified.add(parsed.token)
    }
  }
  return rules
}

export function synthesizeSemanticTokenThemeRules(
  theme: ThemeRegistrationResolved,
  normalizeColor: (color: string | undefined) => string | undefined,
  normalizeFontStyle: (fontStyle: string | undefined) => string
): Monaco.editor.ITokenThemeRule[] {
  const rules: Monaco.editor.ITokenThemeRule[] = []
  for (const [tokenType, scopes] of Object.entries(SEMANTIC_TOKEN_SCOPE_SOURCES)) {
    for (const scope of scopes) {
      const style = resolveThemeStyleForScope(theme.settings ?? [], scope)
      if (!style) {
        continue
      }
      rules.push({
        token: tokenType,
        foreground: normalizeColor(style.foreground),
        fontStyle: normalizeFontStyle(style.fontStyle) || undefined
      })
      break
    }
  }
  // Last so they win over the synthesized fallbacks for the same token key.
  rules.push(...semanticTokenColorRules(theme, normalizeColor, normalizeFontStyle))
  return rules
}
