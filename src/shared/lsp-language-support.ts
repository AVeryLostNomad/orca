import type { LspServerId } from './lsp-types'

/** Monaco language ids (language-detect.ts) each language server covers. */
export const LSP_SERVER_LANGUAGE_IDS: Record<LspServerId, string[]> = {
  typescript: ['typescript', 'javascript'],
  json: ['json'],
  css: ['css', 'scss', 'less'],
  html: ['html'],
  yaml: ['yaml'],
  pyright: ['python'],
  bash: ['shell'],
  dockerfile: ['dockerfile'],
  intelephense: ['php'],
  vue: ['vue'],
  'rust-analyzer': ['rust'],
  clangd: ['c', 'cpp'],
  lua: ['lua'],
  marksman: ['markdown'],
  taplo: ['toml'],
  terraform: ['hcl'],
  gopls: ['go']
}

const SERVER_ID_BY_LANGUAGE = new Map<string, LspServerId>()
for (const [serverId, languageIds] of Object.entries(LSP_SERVER_LANGUAGE_IDS)) {
  for (const languageId of languageIds) {
    SERVER_ID_BY_LANGUAGE.set(languageId, serverId as LspServerId)
  }
}

export function lspServerIdForLanguage(languageId: string): LspServerId | undefined {
  return SERVER_ID_BY_LANGUAGE.get(languageId)
}
