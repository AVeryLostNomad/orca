import type { LanguageRegistration } from '@shikijs/core'

type ShikiLanguageModule = { default: LanguageRegistration[] }

export type ShikiLanguageCatalogEntry = {
  /** Shiki grammar name used at tokenize time; may differ from the Monaco id. */
  shikiLanguage: string
  loadLanguage: () => Promise<ShikiLanguageModule>
}

// Monaco language id → shiki TextMate grammar. Languages absent here keep
// their Monarch/built-in tokenizer (jsonl, csv/tsv, notebook, nim, plaintext).
export const SHIKI_LANGUAGE_CATALOG: Record<string, ShikiLanguageCatalogEntry> = {
  // Why: Monaco has one shared id for .ts/.tsx (and .js/.jsx), so the JSX-capable
  // grammar covers both; old-style `<T>expr` assertions mis-color as JSX, which
  // is the lesser loss versus JSX files rendering plain.
  typescript: { shikiLanguage: 'tsx', loadLanguage: () => import('@shikijs/langs/tsx') },
  javascript: {
    shikiLanguage: 'javascript',
    loadLanguage: () => import('@shikijs/langs/javascript')
  },
  // Why: the JSONC grammar is a superset — comments color instead of erroring.
  json: { shikiLanguage: 'jsonc', loadLanguage: () => import('@shikijs/langs/jsonc') },
  markdown: { shikiLanguage: 'markdown', loadLanguage: () => import('@shikijs/langs/markdown') },
  html: { shikiLanguage: 'html', loadLanguage: () => import('@shikijs/langs/html') },
  css: { shikiLanguage: 'css', loadLanguage: () => import('@shikijs/langs/css') },
  scss: { shikiLanguage: 'scss', loadLanguage: () => import('@shikijs/langs/scss') },
  less: { shikiLanguage: 'less', loadLanguage: () => import('@shikijs/langs/less') },
  xml: { shikiLanguage: 'xml', loadLanguage: () => import('@shikijs/langs/xml') },
  python: { shikiLanguage: 'python', loadLanguage: () => import('@shikijs/langs/python') },
  rust: { shikiLanguage: 'rust', loadLanguage: () => import('@shikijs/langs/rust') },
  go: { shikiLanguage: 'go', loadLanguage: () => import('@shikijs/langs/go') },
  java: { shikiLanguage: 'java', loadLanguage: () => import('@shikijs/langs/java') },
  kotlin: { shikiLanguage: 'kotlin', loadLanguage: () => import('@shikijs/langs/kotlin') },
  c: { shikiLanguage: 'c', loadLanguage: () => import('@shikijs/langs/c') },
  cpp: { shikiLanguage: 'cpp', loadLanguage: () => import('@shikijs/langs/cpp') },
  csharp: { shikiLanguage: 'csharp', loadLanguage: () => import('@shikijs/langs/csharp') },
  ruby: { shikiLanguage: 'ruby', loadLanguage: () => import('@shikijs/langs/ruby') },
  php: { shikiLanguage: 'php', loadLanguage: () => import('@shikijs/langs/php') },
  swift: { shikiLanguage: 'swift', loadLanguage: () => import('@shikijs/langs/swift') },
  shell: {
    shikiLanguage: 'shellscript',
    loadLanguage: () => import('@shikijs/langs/shellscript')
  },
  bat: { shikiLanguage: 'bat', loadLanguage: () => import('@shikijs/langs/bat') },
  powershell: {
    shikiLanguage: 'powershell',
    loadLanguage: () => import('@shikijs/langs/powershell')
  },
  yaml: { shikiLanguage: 'yaml', loadLanguage: () => import('@shikijs/langs/yaml') },
  ini: { shikiLanguage: 'ini', loadLanguage: () => import('@shikijs/langs/ini') },
  toml: { shikiLanguage: 'toml', loadLanguage: () => import('@shikijs/langs/toml') },
  sql: { shikiLanguage: 'sql', loadLanguage: () => import('@shikijs/langs/sql') },
  graphql: { shikiLanguage: 'graphql', loadLanguage: () => import('@shikijs/langs/graphql') },
  dockerfile: {
    shikiLanguage: 'dockerfile',
    loadLanguage: () => import('@shikijs/langs/dockerfile')
  },
  lua: { shikiLanguage: 'lua', loadLanguage: () => import('@shikijs/langs/lua') },
  r: { shikiLanguage: 'r', loadLanguage: () => import('@shikijs/langs/r') },
  scala: { shikiLanguage: 'scala', loadLanguage: () => import('@shikijs/langs/scala') },
  dart: { shikiLanguage: 'dart', loadLanguage: () => import('@shikijs/langs/dart') },
  elixir: { shikiLanguage: 'elixir', loadLanguage: () => import('@shikijs/langs/elixir') },
  erlang: { shikiLanguage: 'erlang', loadLanguage: () => import('@shikijs/langs/erlang') },
  haskell: { shikiLanguage: 'haskell', loadLanguage: () => import('@shikijs/langs/haskell') },
  clojure: { shikiLanguage: 'clojure', loadLanguage: () => import('@shikijs/langs/clojure') },
  vue: { shikiLanguage: 'vue', loadLanguage: () => import('@shikijs/langs/vue') },
  svelte: { shikiLanguage: 'svelte', loadLanguage: () => import('@shikijs/langs/svelte') },
  astro: { shikiLanguage: 'astro', loadLanguage: () => import('@shikijs/langs/astro') },
  hcl: { shikiLanguage: 'hcl', loadLanguage: () => import('@shikijs/langs/hcl') },
  proto: { shikiLanguage: 'proto', loadLanguage: () => import('@shikijs/langs/proto') },
  makefile: { shikiLanguage: 'makefile', loadLanguage: () => import('@shikijs/langs/makefile') },
  cmake: { shikiLanguage: 'cmake', loadLanguage: () => import('@shikijs/langs/cmake') },
  perl: { shikiLanguage: 'perl', loadLanguage: () => import('@shikijs/langs/perl') },
  mermaid: { shikiLanguage: 'mermaid', loadLanguage: () => import('@shikijs/langs/mermaid') },
  systemverilog: {
    shikiLanguage: 'system-verilog',
    loadLanguage: () => import('@shikijs/langs/system-verilog')
  },
  verilog: { shikiLanguage: 'verilog', loadLanguage: () => import('@shikijs/langs/verilog') }
}

export function getShikiLanguageCatalogEntry(
  monacoLanguageId: string
): ShikiLanguageCatalogEntry | undefined {
  return SHIKI_LANGUAGE_CATALOG[monacoLanguageId]
}
