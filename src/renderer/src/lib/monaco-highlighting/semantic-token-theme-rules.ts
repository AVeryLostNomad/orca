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
  return rules
}
