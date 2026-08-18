import type * as Monaco from 'monaco-editor'
import { getShikiHighlighter } from './shiki-highlighter'
import { getShikiLanguageCatalogEntry } from './shiki-language-catalog'
import { createShikiTokensProvider } from './shiki-tokens-provider'

type MonacoModule = typeof Monaco

const swappedLanguageIds = new Set<string>()
const inFlightLanguageIds = new Set<string>()
let installed = false

// Model-driven lazy upgrade: built-in/Monarch tokenizers keep painting the
// instant a file opens; once the TextMate grammar chunk loads, the provider
// swap retokenizes open models. Call only after a shiki theme has been
// applied — before that the color→scope index is empty and tokens would
// render plain.
export function installShikiTokenization(monaco: MonacoModule): void {
  if (installed) {
    return
  }
  installed = true
  monaco.editor.onDidCreateModel((model) => {
    void ensureShikiTokensForLanguage(monaco, model.getLanguageId())
  })
  monaco.editor.onDidChangeModelLanguage((event) => {
    void ensureShikiTokensForLanguage(monaco, event.model.getLanguageId())
  })
  for (const model of monaco.editor.getModels()) {
    void ensureShikiTokensForLanguage(monaco, model.getLanguageId())
  }
}

async function ensureShikiTokensForLanguage(
  monaco: MonacoModule,
  languageId: string
): Promise<void> {
  if (swappedLanguageIds.has(languageId) || inFlightLanguageIds.has(languageId)) {
    return
  }
  const entry = getShikiLanguageCatalogEntry(languageId)
  if (!entry) {
    return
  }
  inFlightLanguageIds.add(languageId)
  try {
    const highlighter = await getShikiHighlighter()
    const languageModule = await entry.loadLanguage()
    await highlighter.loadLanguage(languageModule.default)
    const grammar = highlighter.getLanguage(entry.shikiLanguage)
    monaco.languages.setTokensProvider(languageId, createShikiTokensProvider(grammar))
    swappedLanguageIds.add(languageId)
  } catch (error) {
    // Grammar load failure keeps the Monarch/built-in tokenizer; the next
    // model of this language retries.
    console.warn(`Failed to load TextMate grammar for ${languageId}`, error)
  } finally {
    inFlightLanguageIds.delete(languageId)
  }
}
