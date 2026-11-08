import type * as Monaco from 'monaco-editor'
import {
  conf as cssConf,
  language as cssLanguage
} from 'monaco-editor/esm/vs/basic-languages/css/css.js'

type MonacoModule = Pick<typeof Monaco, 'languages'>

// CSS coloring under its own id: the CSS worker and language server would flag USS-only -unity-* properties and resource()/url() forms.
export const USS_LANGUAGE_ID = 'uss'

export const ussMonarchLanguage: Monaco.languages.IMonarchLanguage = {
  ...cssLanguage,
  tokenPostfix: '.uss'
}

export function registerUssLanguage(monaco: MonacoModule): void {
  if (monaco.languages.getLanguages().some((language) => language.id === USS_LANGUAGE_ID)) {
    return
  }
  monaco.languages.register({
    id: USS_LANGUAGE_ID,
    extensions: ['.uss', '.tss'],
    aliases: ['Unity Style Sheet', 'uss']
  })
  monaco.languages.setLanguageConfiguration(USS_LANGUAGE_ID, cssConf)
  monaco.languages.setMonarchTokensProvider(USS_LANGUAGE_ID, ussMonarchLanguage)
}
