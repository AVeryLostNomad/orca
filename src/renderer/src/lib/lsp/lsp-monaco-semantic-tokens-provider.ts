import type * as Monaco from 'monaco-editor'
import { requestLsp, type LspWorkspaceSession } from './lsp-client'
import { lspBindingFor, lspCapability } from './lsp-provider-binding-access'

type MonacoModule = typeof Monaco

type SemanticTokensDelta = {
  resultId?: string
  data?: number[]
  edits?: { start: number; deleteCount: number; data?: number[] }[]
}

export function registerLspSemanticTokensProvider(
  monaco: MonacoModule,
  languageId: string,
  firstSession: LspWorkspaceSession
): void {
  const semanticTokensOptions = lspCapability<{
    legend?: { tokenTypes: string[]; tokenModifiers: string[] }
    full?: boolean | { delta?: boolean }
  }>(firstSession, 'semanticTokensProvider')
  if (!semanticTokensOptions?.legend || !semanticTokensOptions.full) {
    return
  }
  const supportsDelta =
    typeof semanticTokensOptions.full === 'object' && semanticTokensOptions.full.delta === true
  monaco.languages.registerDocumentSemanticTokensProvider(languageId, {
    getLegend: () => ({
      tokenTypes: semanticTokensOptions.legend?.tokenTypes ?? [],
      tokenModifiers: semanticTokensOptions.legend?.tokenModifiers ?? []
    }),
    async provideDocumentSemanticTokens(model, lastResultId, token) {
      const binding = lspBindingFor(model)
      if (!binding || !lspCapability(binding.session, 'semanticTokensProvider')) {
        return null
      }
      if (lastResultId && supportsDelta) {
        const delta = await requestLsp<SemanticTokensDelta | null>(
          binding.session,
          'textDocument/semanticTokens/full/delta',
          { textDocument: { uri: binding.uri }, previousResultId: lastResultId },
          token
        )
        if (!delta) {
          return null
        }
        if (delta.edits) {
          return {
            resultId: delta.resultId,
            edits: delta.edits.map((edit) => ({
              start: edit.start,
              deleteCount: edit.deleteCount,
              data: edit.data ? Uint32Array.from(edit.data) : undefined
            }))
          }
        }
        return { resultId: delta.resultId, data: Uint32Array.from(delta.data ?? []) }
      }
      const tokens = await requestLsp<{ resultId?: string; data: number[] } | null>(
        binding.session,
        'textDocument/semanticTokens/full',
        { textDocument: { uri: binding.uri } },
        token
      )
      if (!tokens) {
        return null
      }
      return { resultId: tokens.resultId, data: Uint32Array.from(tokens.data) }
    },
    releaseDocumentSemanticTokens: () => {}
  })
}
