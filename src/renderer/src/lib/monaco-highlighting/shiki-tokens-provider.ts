import type * as Monaco from 'monaco-editor'
import type { Grammar } from '@shikijs/core'
import { EncodedTokenMetadata, INITIAL } from '@shikijs/vscode-textmate'
import type { FontStyle, StateStack } from '@shikijs/vscode-textmate'
import {
  colorStyleKey,
  getMonacoShikiThemeApplication,
  normalizeThemeColor
} from './monaco-shiki-theme'

// Lines longer than this skip TextMate tokenization entirely (minified code);
// the time limit bounds pathological grammar backtracking per line.
const TOKENIZE_MAX_LINE_LENGTH = 2000
const TOKENIZE_TIME_LIMIT_MS = 500

class ShikiTokenizerState implements Monaco.languages.IState {
  constructor(readonly ruleStack: StateStack) {}

  clone(): ShikiTokenizerState {
    return new ShikiTokenizerState(this.ruleStack)
  }

  equals(other: Monaco.languages.IState): boolean {
    // Why: vscode-textmate reuses immutable StateStack instances, so reference
    // equality is the correct (and cheap) line-state comparison.
    return other instanceof ShikiTokenizerState && other.ruleStack === this.ruleStack
  }
}

const FONT_STYLE_LABELS: [number, string][] = [
  [1, 'italic'],
  [2, 'bold'],
  [4, 'underline'],
  [8, 'strikethrough']
]

function fontStyleBitsToLabel(fontStyle: FontStyle): string {
  if (fontStyle <= 0) {
    return ''
  }
  const styles: string[] = []
  for (const [bit, label] of FONT_STYLE_LABELS) {
    if (fontStyle & bit) {
      styles.push(label)
    }
  }
  return styles.join(' ')
}

export function createShikiTokensProvider(grammar: Grammar): Monaco.languages.TokensProvider {
  return {
    getInitialState() {
      return new ShikiTokenizerState(INITIAL)
    },
    tokenize(line, state) {
      const shikiState =
        state instanceof ShikiTokenizerState ? state : new ShikiTokenizerState(INITIAL)
      if (line.length >= TOKENIZE_MAX_LINE_LENGTH) {
        return { endState: shikiState, tokens: [{ startIndex: 0, scopes: '' }] }
      }
      const application = getMonacoShikiThemeApplication()
      const result = grammar.tokenizeLine2(line, shikiState.ruleStack, TOKENIZE_TIME_LIMIT_MS)
      const tokenCount = result.tokens.length / 2
      const tokens: Monaco.languages.IToken[] = []
      for (let index = 0; index < tokenCount; index++) {
        const startIndex = result.tokens[2 * index]
        const metadata = result.tokens[2 * index + 1]
        const colorIndex = EncodedTokenMetadata.getForeground(metadata)
        const color = normalizeThemeColor(application.colorMap[colorIndex])
        const fontStyle = fontStyleBitsToLabel(EncodedTokenMetadata.getFontStyle(metadata))
        const scope = color
          ? (application.scopeByColorStyle.get(colorStyleKey(color, fontStyle)) ?? '')
          : ''
        tokens.push({ startIndex, scopes: scope })
      }
      return { endState: new ShikiTokenizerState(result.ruleStack), tokens }
    }
  }
}
