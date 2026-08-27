import type { LspServerId } from './lsp-types'

/** Monaco language ids (language-detect.ts) each language server covers. */
export const LSP_SERVER_LANGUAGE_IDS: Record<LspServerId, string[]> = {
  typescript: ['typescript', 'javascript'],
  angular: ['html'],
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

/** Project-conditional takeovers: in a matching workspace the override server
 *  claims the base server's languages (e.g. Angular templates are .html). */
export const LSP_PROJECT_SERVER_OVERRIDES: Partial<Record<LspServerId, LspServerId>> = {
  html: 'angular'
}

const OVERRIDE_SERVER_IDS = new Set<LspServerId>(
  Object.values(LSP_PROJECT_SERVER_OVERRIDES) as LspServerId[]
)

const SERVER_ID_BY_LANGUAGE = new Map<string, LspServerId>()
for (const [serverId, languageIds] of Object.entries(LSP_SERVER_LANGUAGE_IDS)) {
  if (OVERRIDE_SERVER_IDS.has(serverId as LspServerId)) {
    continue
  }
  for (const languageId of languageIds) {
    SERVER_ID_BY_LANGUAGE.set(languageId, serverId as LspServerId)
  }
}

export function lspServerIdForLanguage(languageId: string): LspServerId | undefined {
  return SERVER_ID_BY_LANGUAGE.get(languageId)
}
