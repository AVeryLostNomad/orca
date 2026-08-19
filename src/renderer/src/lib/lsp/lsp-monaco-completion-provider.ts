import type * as Monaco from 'monaco-editor'
import type { CompletionItem, CompletionList } from 'vscode-languageserver-protocol'
import { requestLsp, type LspWorkspaceSession } from './lsp-client'
import { toMonacoCompletionItem } from './lsp-monaco-converters'
import { lspBindingFor, lspCapability, lspPositionParams } from './lsp-provider-binding-access'

type MonacoModule = typeof Monaco

// Round-trips the raw LSP item through Monaco for completionItem/resolve.
const lspItemByMonacoItem = new WeakMap<
  Monaco.languages.CompletionItem,
  { item: CompletionItem; session: LspWorkspaceSession }
>()

export function registerLspCompletionProvider(
  monaco: MonacoModule,
  languageId: string,
  firstSession: LspWorkspaceSession
): void {
  const completionOptions = lspCapability<{ triggerCharacters?: string[] }>(
    firstSession,
    'completionProvider'
  )
  monaco.languages.registerCompletionItemProvider(languageId, {
    triggerCharacters: completionOptions?.triggerCharacters ?? [],
    async provideCompletionItems(model, position, context, token) {
      const binding = lspBindingFor(model)
      if (!binding || !lspCapability(binding.session, 'completionProvider')) {
        return null
      }
      const response = await requestLsp<CompletionItem[] | CompletionList | null>(
        binding.session,
        'textDocument/completion',
        {
          ...lspPositionParams(binding, position),
          context: {
            triggerKind: context.triggerKind + 1,
            triggerCharacter: context.triggerCharacter
          }
        },
        token
      )
      if (!response) {
        return null
      }
      const items = Array.isArray(response) ? response : response.items
      const wordInfo = model.getWordUntilPosition(position)
      const defaultRange: Monaco.IRange = {
        startLineNumber: position.lineNumber,
        startColumn: wordInfo.startColumn,
        endLineNumber: position.lineNumber,
        endColumn: wordInfo.endColumn
      }
      const suggestions = items.map((item) => {
        const monacoItem = toMonacoCompletionItem(item, defaultRange)
        lspItemByMonacoItem.set(monacoItem, { item, session: binding.session })
        return monacoItem
      })
      return {
        suggestions,
        incomplete: !Array.isArray(response) && Boolean(response.isIncomplete)
      }
    },
    async resolveCompletionItem(item, token) {
      const stashed = lspItemByMonacoItem.get(item)
      if (
        !stashed ||
        !lspCapability<{ resolveProvider?: boolean }>(stashed.session, 'completionProvider')
          ?.resolveProvider
      ) {
        return item
      }
      const resolved = await requestLsp<CompletionItem>(
        stashed.session,
        'completionItem/resolve',
        stashed.item,
        token
      )
      if (!resolved) {
        return item
      }
      const merged = toMonacoCompletionItem(resolved, item.range as Monaco.IRange)
      // Keep Monaco's identity fields; only enrich what resolve adds.
      return {
        ...item,
        detail: merged.detail ?? item.detail,
        documentation: merged.documentation ?? item.documentation,
        additionalTextEdits: merged.additionalTextEdits ?? item.additionalTextEdits
      }
    }
  })
}
