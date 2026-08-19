import type * as Monaco from 'monaco-editor'

type MonacoModule = typeof Monaco

// No Monarch tokenizer on purpose: shiki's TextMate grammar takes over on
// first use (register-shiki-languages); until then TOML renders plain, which
// beats the previous mis-highlighting through the ini grammar.
export function registerTomlLanguage(monaco: MonacoModule): void {
  if (monaco.languages.getLanguages().some((language) => language.id === 'toml')) {
    return
  }
  monaco.languages.register({
    id: 'toml',
    extensions: ['.toml'],
    aliases: ['TOML', 'toml']
  })
  monaco.languages.setLanguageConfiguration('toml', {
    comments: { lineComment: '#' },
    brackets: [
      ['[', ']'],
      ['{', '}']
    ],
    autoClosingPairs: [
      { open: '[', close: ']' },
      { open: '{', close: '}' },
      { open: '"', close: '"' },
      { open: "'", close: "'" }
    ],
    surroundingPairs: [
      { open: '[', close: ']' },
      { open: '{', close: '}' },
      { open: '"', close: '"' },
      { open: "'", close: "'" }
    ]
  })
}
