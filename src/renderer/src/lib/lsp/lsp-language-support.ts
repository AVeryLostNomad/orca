// Why top-level imports: monaco 0.55 moved the language-service namespaces off
// `monaco.languages.*` (now deprecated stubs) onto module exports.
import {
  css as monacoCss,
  html as monacoHtml,
  json as monacoJson,
  typescript as monacoTypescript
} from 'monaco-editor'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { LspServerId } from '../../../../shared/lsp-types'
import { lspServerIdForLanguage } from '../../../../shared/lsp-language-support'

export function lspServerForLanguageIfEnabled(
  settings: GlobalSettings | null,
  languageId: string
): LspServerId | null {
  if (!settings?.lspEnabled) {
    return null
  }
  const serverId = lspServerIdForLanguage(languageId)
  if (!serverId || settings.lspDisabledServers?.includes(serverId)) {
    return null
  }
  return serverId
}

const gatedServerIds = new Set<LspServerId>()

// Once an LSP session serves a language Monaco's built-in workers also cover,
// switch the workers' overlapping features off so users never see doubled
// completions/hovers. Tokenization stays on (instant paint before shiki).
export function disableBuiltInFeaturesForLspServer(serverId: LspServerId): void {
  if (gatedServerIds.has(serverId)) {
    return
  }
  gatedServerIds.add(serverId)
  if (serverId === 'typescript') {
    const modeConfiguration = {
      completionItems: false,
      hovers: false,
      documentSymbols: false,
      definitions: false,
      references: false,
      documentHighlights: false,
      rename: false,
      signatureHelp: false,
      onTypeFormattingEdits: false,
      codeActions: false,
      inlayHints: false,
      diagnostics: false
    }
    monacoTypescript.typescriptDefaults.setModeConfiguration(modeConfiguration)
    monacoTypescript.javascriptDefaults.setModeConfiguration(modeConfiguration)
    return
  }
  if (serverId === 'json') {
    monacoJson.jsonDefaults.setModeConfiguration({
      documentFormattingEdits: false,
      documentRangeFormattingEdits: false,
      completionItems: false,
      hovers: false,
      documentSymbols: false,
      tokens: true,
      colors: true,
      foldingRanges: false,
      diagnostics: false,
      selectionRanges: true
    })
    return
  }
  if (serverId === 'css') {
    const modeConfiguration = {
      completionItems: false,
      hovers: false,
      documentSymbols: false,
      definitions: false,
      references: false,
      documentHighlights: false,
      rename: false,
      colors: true,
      foldingRanges: false,
      diagnostics: false,
      selectionRanges: true,
      documentFormattingEdits: false,
      documentRangeFormattingEdits: false
    }
    monacoCss.cssDefaults.setModeConfiguration(modeConfiguration)
    monacoCss.scssDefaults.setModeConfiguration(modeConfiguration)
    monacoCss.lessDefaults.setModeConfiguration(modeConfiguration)
    return
  }
  if (serverId === 'html') {
    monacoHtml.htmlDefaults.setModeConfiguration({
      completionItems: false,
      hovers: false,
      documentSymbols: false,
      links: true,
      documentHighlights: false,
      rename: false,
      colors: true,
      foldingRanges: false,
      selectionRanges: true,
      diagnostics: false,
      documentFormattingEdits: false,
      documentRangeFormattingEdits: false
    })
  }
}
