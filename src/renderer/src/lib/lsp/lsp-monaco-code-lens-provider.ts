import type * as Monaco from 'monaco-editor'
import type { CodeLens } from 'vscode-languageserver-protocol'
import { requestLsp } from './lsp-client'
import { toMonacoLspCommand } from './lsp-client-commands'
import type { LspDocumentBinding } from './lsp-document-binding'
import { toMonacoRange } from './lsp-monaco-converters'
import { lspBindingFor, lspCapability } from './lsp-provider-binding-access'
import { onLspRefreshRequest } from './lsp-refresh-requests'

type MonacoModule = typeof Monaco

const lspLensByMonacoLens = new WeakMap<
  Monaco.languages.CodeLens,
  { lens: CodeLens; binding: LspDocumentBinding }
>()

function toMonacoCodeLens(
  monaco: MonacoModule,
  binding: LspDocumentBinding,
  lens: CodeLens
): Monaco.languages.CodeLens {
  const monacoLens: Monaco.languages.CodeLens = {
    range: toMonacoRange(lens.range),
    command: lens.command
      ? toMonacoLspCommand(monaco, binding, lens.command, 'advertised')
      : undefined
  }
  lspLensByMonacoLens.set(monacoLens, { lens, binding })
  return monacoLens
}

export function registerLspCodeLensProvider(monaco: MonacoModule, languageId: string): void {
  const changed = new monaco.Emitter<Monaco.languages.CodeLensProvider>()
  const provider: Monaco.languages.CodeLensProvider = {
    onDidChange: changed.event,
    async provideCodeLenses(model, token) {
      const binding = lspBindingFor(model)
      if (!binding || !lspCapability(binding.session, 'codeLensProvider')) {
        return null
      }
      const lenses = await requestLsp<CodeLens[] | null>(
        binding.session,
        'textDocument/codeLens',
        { textDocument: { uri: binding.uri } },
        token
      )
      if (!lenses) {
        return null
      }
      return {
        lenses: lenses.map((lens) => toMonacoCodeLens(monaco, binding, lens)),
        dispose: () => {}
      }
    },
    async resolveCodeLens(_model, codeLens, token) {
      const stashed = lspLensByMonacoLens.get(codeLens)
      if (
        !stashed ||
        codeLens.command ||
        !lspCapability<{ resolveProvider?: boolean }>(stashed.binding.session, 'codeLensProvider')
          ?.resolveProvider
      ) {
        return codeLens
      }
      const resolved = await requestLsp<CodeLens>(
        stashed.binding.session,
        'codeLens/resolve',
        stashed.lens,
        token
      )
      if (token.isCancellationRequested) {
        // Unresolved lenses are retried on the next render pass.
        return codeLens
      }
      return {
        range: codeLens.range,
        // An empty title renders nothing instead of Monaco's "no commands".
        command: resolved?.command
          ? toMonacoLspCommand(monaco, stashed.binding, resolved.command, 'advertised')
          : { id: '', title: '' }
      }
    }
  }
  onLspRefreshRequest('codeLens', () => changed.fire(provider))
  monaco.languages.registerCodeLensProvider(languageId, provider)
}
