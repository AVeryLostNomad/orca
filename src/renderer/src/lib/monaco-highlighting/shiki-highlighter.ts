import { createHighlighterCore } from '@shikijs/core'
import type { HighlighterCore } from '@shikijs/core'
import { createOnigurumaEngine } from '@shikijs/engine-oniguruma'

let highlighterPromise: Promise<HighlighterCore> | undefined

// One shared registry so every grammar/theme loads once. The engine must use
// shiki's own oniguruma build (wasm-inlined, a lazy chunk) — vscode-oniguruma's
// onig.wasm has embind imports the shiki engine cannot link.
export function getShikiHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    engine: createOnigurumaEngine(import('@shikijs/engine-oniguruma/wasm-inlined')),
    langs: [],
    themes: []
  })
  return highlighterPromise
}
