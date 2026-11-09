import type * as Monaco from 'monaco-editor'
import type { CompletionItem, CompletionList } from 'vscode-languageserver-protocol'
import type { LspServerId } from '../../../../shared/lsp-types'
import { requestLsp, type LspWorkspaceSession } from './lsp-client'
import { executeLspCommand } from './lsp-client-commands'
import {
  completionListReplaceStart,
  lspCompletionItemsWithDefaults,
  narrowIncompleteCompletionList
} from './lsp-completion-list'
import type { LspDocumentBinding } from './lsp-document-binding'
import { toMonacoCompletionItem } from './lsp-monaco-converters'
import { lspBindingFor, lspCapability, lspPositionParams } from './lsp-provider-binding-access'

type MonacoModule = typeof Monaco

type CompletionOptions = {
  triggerCharacters?: string[]
  allCommitCharacters?: string[]
  resolveProvider?: boolean
}

type CompletionEntry = {
  item: CompletionItem
  binding: LspDocumentBinding
  resolved?: CompletionItem
  pending?: Promise<CompletionItem | undefined>
}

// Round-trips the raw LSP item through Monaco for completionItem/resolve.
const entryByMonacoItem = new WeakMap<Monaco.languages.CompletionItem, CompletionEntry>()
const COMPLETION_ACCEPTED_COMMAND = 'orca.lsp.completionAccepted'
const registeredMonacos = new WeakSet<object>()
// Servers that rank every match ahead of non-matches before truncating an incomplete list
// (Roslyn: CompletionHandler.FilterCompletionList), so a non-matching tail proves completeness.
const SERVERS_RANKING_MATCHES_FIRST: Partial<Record<LspServerId, true>> = { csharp: true }

/** Text Monaco filters default-range items by: replace start to caret, when both share a line. */
function typedPrefixForList(
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
  list: CompletionList
): string {
  const start = completionListReplaceStart(list)
  if (!start || start.line !== position.lineNumber - 1 || start.character > position.column - 1) {
    return ''
  }
  return model.getLineContent(position.lineNumber).slice(start.character, position.column - 1)
}

// Shared by Monaco's focus-time resolve and the accept command, so accepting
// never issues a second resolve; failures/cancellations stay retryable.
function resolveCompletionEntry(
  entry: CompletionEntry,
  token?: Monaco.CancellationToken
): Promise<CompletionItem | undefined> {
  const options = lspCapability<CompletionOptions>(entry.binding.session, 'completionProvider')
  if (entry.resolved || options?.resolveProvider !== true) {
    return Promise.resolve(entry.resolved)
  }
  entry.pending ??= requestLsp<CompletionItem>(
    entry.binding.session,
    'completionItem/resolve',
    entry.item,
    token
  ).then((resolved) => {
    entry.pending = undefined
    if (resolved) {
      entry.resolved = resolved
    }
    return resolved
  })
  return entry.pending
}

// Monaco reads `command` synchronously at accept time, before a pending
// resolve lands; Roslyn only supplies its complex-edit command from resolve.
function installCompletionAcceptedCommand(monaco: MonacoModule): void {
  if (registeredMonacos.has(monaco)) {
    return
  }
  registeredMonacos.add(monaco)
  monaco.editor.registerCommand(
    COMPLETION_ACCEPTED_COMMAND,
    async (_accessor, entry: CompletionEntry) => {
      if (!entry || entry.binding.model.isDisposed()) {
        return
      }
      // A focus-time resolve cancelled by the widget closing yields undefined; retry once.
      const resolved =
        (await resolveCompletionEntry(entry)) ?? (await resolveCompletionEntry(entry))
      const command = resolved?.command ?? entry.item.command
      if (command && !entry.binding.model.isDisposed()) {
        await executeLspCommand(monaco, entry.binding, command, 'advertised')
      }
    }
  )
}

export function registerLspCompletionProvider(
  monaco: MonacoModule,
  languageId: string,
  firstSession: LspWorkspaceSession
): void {
  installCompletionAcceptedCommand(monaco)
  const completionOptions = lspCapability<CompletionOptions>(firstSession, 'completionProvider')
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
      const narrowed = Array.isArray(response)
        ? response
        : narrowIncompleteCompletionList(
            response,
            typedPrefixForList(model, position, response),
            SERVERS_RANKING_MATCHES_FIRST[binding.session.serverId] === true
          )
      const options = lspCapability<CompletionOptions>(binding.session, 'completionProvider')
      const items = lspCompletionItemsWithDefaults(narrowed, options?.allCommitCharacters)
      const wordInfo = model.getWordUntilPosition(position)
      const defaultRange: Monaco.IRange = {
        startLineNumber: position.lineNumber,
        startColumn: wordInfo.startColumn,
        endLineNumber: position.lineNumber,
        endColumn: wordInfo.endColumn
      }
      const resolvable = options?.resolveProvider === true
      const suggestions = items.map((item) => {
        const monacoItem = toMonacoCompletionItem(item, defaultRange)
        const entry: CompletionEntry = { item, binding }
        entryByMonacoItem.set(monacoItem, entry)
        if (item.command || resolvable) {
          monacoItem.command = {
            id: COMPLETION_ACCEPTED_COMMAND,
            title: item.command?.title ?? '',
            arguments: [entry]
          }
        }
        return monacoItem
      })
      return {
        suggestions,
        incomplete: !Array.isArray(narrowed) && Boolean(narrowed.isIncomplete)
      }
    },
    async resolveCompletionItem(item, token) {
      const entry = entryByMonacoItem.get(item)
      const resolved = entry && (await resolveCompletionEntry(entry, token))
      if (!resolved) {
        return item
      }
      const merged = toMonacoCompletionItem(resolved, item.range)
      // Keep Monaco's identity fields (and the accept command); only enrich what resolve adds.
      return {
        ...item,
        detail: merged.detail ?? item.detail,
        documentation: merged.documentation ?? item.documentation,
        additionalTextEdits: merged.additionalTextEdits ?? item.additionalTextEdits
      }
    }
  })
}
