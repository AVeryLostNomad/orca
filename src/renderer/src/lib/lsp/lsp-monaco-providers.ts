import type * as Monaco from 'monaco-editor'
import type {
  DocumentHighlight,
  DocumentSymbol,
  FoldingRange,
  Hover,
  InlayHint,
  Location,
  LocationLink,
  SignatureHelp,
  SymbolInformation,
  TextEdit
} from 'vscode-languageserver-protocol'
import { requestLsp, type LspWorkspaceSession } from './lsp-client'
import {
  toLspRange,
  toMonacoDocumentHighlights,
  toMonacoDocumentSymbols,
  toMonacoFoldingRanges,
  toMonacoHover,
  toMonacoInlayHints,
  toMonacoLocations,
  toMonacoMarkdown,
  toMonacoSignatureHelp,
  toMonacoTextEdits
} from './lsp-monaco-converters'
import type { LspDocumentBinding } from './lsp-document-binding'
import { lspBindingFor, lspCapability, lspPositionParams } from './lsp-provider-binding-access'
import { resolveLspLocationModels } from './lsp-location-models'
import { registerLspCodeActionProvider } from './lsp-monaco-code-action-provider'
import { registerLspCodeLensProvider } from './lsp-monaco-code-lens-provider'
import { registerLspCompletionProvider } from './lsp-monaco-completion-provider'
import { registerLspRenameProvider } from './lsp-monaco-rename-provider'
import { registerLspSemanticTokensProvider } from './lsp-monaco-semantic-tokens-provider'
import { ensureLspWorkspaceEditHandler } from './lsp-monaco-workspace-edit'
import { onLspRefreshRequest } from './lsp-refresh-requests'

type MonacoModule = typeof Monaco

const providersByLanguage = new Set<string>()
// Round-trips the raw LSP hint through Monaco for inlayHint/resolve.
const lspInlayHintByMonacoHint = new WeakMap<
  Monaco.languages.InlayHint,
  { hint: InlayHint; binding: LspDocumentBinding }
>()

/** Register the full provider suite for a Monaco language id (idempotent).
 *  Providers resolve the model's binding at call time, so any number of
 *  workspaces/sessions share one registration. */
export function ensureLspProvidersForLanguage(
  monaco: MonacoModule,
  languageId: string,
  firstSession: LspWorkspaceSession
): void {
  ensureLspWorkspaceEditHandler(monaco)

  if (providersByLanguage.has(languageId)) {
    return
  }
  providersByLanguage.add(languageId)

  registerLspCodeActionProvider(monaco, languageId)
  registerLspCompletionProvider(monaco, languageId, firstSession)
  registerLspRenameProvider(monaco, languageId)
  registerLspSemanticTokensProvider(monaco, languageId, firstSession)
  registerLspCodeLensProvider(monaco, languageId)

  monaco.languages.registerHoverProvider(languageId, {
    async provideHover(model, position, token) {
      const binding = lspBindingFor(model)
      if (!binding || !lspCapability(binding.session, 'hoverProvider')) {
        return null
      }
      const hover = await requestLsp<Hover | null>(
        binding.session,
        'textDocument/hover',
        lspPositionParams(binding, position),
        token
      )
      return toMonacoHover(hover) ?? null
    }
  })

  const signatureOptions = lspCapability<{
    triggerCharacters?: string[]
    retriggerCharacters?: string[]
  }>(firstSession, 'signatureHelpProvider')
  monaco.languages.registerSignatureHelpProvider(languageId, {
    signatureHelpTriggerCharacters: signatureOptions?.triggerCharacters ?? [],
    signatureHelpRetriggerCharacters: signatureOptions?.retriggerCharacters ?? [],
    async provideSignatureHelp(model, position, token, context) {
      const binding = lspBindingFor(model)
      if (!binding || !lspCapability(binding.session, 'signatureHelpProvider')) {
        return null
      }
      const help = await requestLsp<SignatureHelp | null>(
        binding.session,
        'textDocument/signatureHelp',
        {
          ...lspPositionParams(binding, position),
          context: {
            triggerKind: context.triggerKind,
            triggerCharacter: context.triggerCharacter,
            isRetrigger: context.isRetrigger
          }
        },
        token
      )
      const converted = toMonacoSignatureHelp(help)
      return converted ? { value: converted, dispose: () => {} } : null
    }
  })

  const locationProvider = (
    method: string,
    capabilityKey: string
  ): ((
    model: Monaco.editor.ITextModel,
    position: Monaco.IPosition,
    token: Monaco.CancellationToken
  ) => Promise<Monaco.languages.Location[] | null>) => {
    return async (model, position, token) => {
      const binding = lspBindingFor(model)
      if (!binding || !lspCapability(binding.session, capabilityKey)) {
        return null
      }
      const result = await requestLsp<Location | Location[] | LocationLink[] | null>(
        binding.session,
        method,
        method === 'textDocument/references'
          ? { ...lspPositionParams(binding, position), context: { includeDeclaration: true } }
          : lspPositionParams(binding, position),
        token
      )
      return resolveLspLocationModels(monaco, binding.session, toMonacoLocations(monaco, result))
    }
  }

  monaco.languages.registerDefinitionProvider(languageId, {
    provideDefinition: locationProvider('textDocument/definition', 'definitionProvider')
  })
  monaco.languages.registerTypeDefinitionProvider(languageId, {
    provideTypeDefinition: locationProvider('textDocument/typeDefinition', 'typeDefinitionProvider')
  })
  monaco.languages.registerImplementationProvider(languageId, {
    provideImplementation: locationProvider('textDocument/implementation', 'implementationProvider')
  })
  monaco.languages.registerReferenceProvider(languageId, {
    provideReferences: async (model, position, _context, token) =>
      locationProvider('textDocument/references', 'referencesProvider')(model, position, token)
  })

  monaco.languages.registerDocumentHighlightProvider(languageId, {
    async provideDocumentHighlights(model, position, token) {
      const binding = lspBindingFor(model)
      if (!binding || !lspCapability(binding.session, 'documentHighlightProvider')) {
        return null
      }
      const highlights = await requestLsp<DocumentHighlight[] | null>(
        binding.session,
        'textDocument/documentHighlight',
        lspPositionParams(binding, position),
        token
      )
      return toMonacoDocumentHighlights(highlights)
    }
  })

  monaco.languages.registerDocumentSymbolProvider(languageId, {
    async provideDocumentSymbols(model, token) {
      const binding = lspBindingFor(model)
      if (!binding || !lspCapability(binding.session, 'documentSymbolProvider')) {
        return null
      }
      const symbols = await requestLsp<DocumentSymbol[] | SymbolInformation[] | null>(
        binding.session,
        'textDocument/documentSymbol',
        { textDocument: { uri: binding.uri } },
        token
      )
      return toMonacoDocumentSymbols(symbols)
    }
  })

  monaco.languages.registerFoldingRangeProvider(languageId, {
    async provideFoldingRanges(model, _context, token) {
      const binding = lspBindingFor(model)
      if (!binding || !lspCapability(binding.session, 'foldingRangeProvider')) {
        return null
      }
      const ranges = await requestLsp<FoldingRange[] | null>(
        binding.session,
        'textDocument/foldingRange',
        { textDocument: { uri: binding.uri } },
        token
      )
      return toMonacoFoldingRanges(ranges)
    }
  })

  monaco.languages.registerDocumentFormattingEditProvider(languageId, {
    async provideDocumentFormattingEdits(model, options, token) {
      const binding = lspBindingFor(model)
      if (!binding || !lspCapability(binding.session, 'documentFormattingProvider')) {
        return null
      }
      const edits = await requestLsp<TextEdit[] | null>(
        binding.session,
        'textDocument/formatting',
        {
          textDocument: { uri: binding.uri },
          options: { tabSize: options.tabSize, insertSpaces: options.insertSpaces }
        },
        token
      )
      return toMonacoTextEdits(edits)
    }
  })

  monaco.languages.registerDocumentRangeFormattingEditProvider(languageId, {
    async provideDocumentRangeFormattingEdits(model, range, options, token) {
      const binding = lspBindingFor(model)
      if (!binding || !lspCapability(binding.session, 'documentRangeFormattingProvider')) {
        return null
      }
      const edits = await requestLsp<TextEdit[] | null>(
        binding.session,
        'textDocument/rangeFormatting',
        {
          textDocument: { uri: binding.uri },
          range: toLspRange(range),
          options: { tabSize: options.tabSize, insertSpaces: options.insertSpaces }
        },
        token
      )
      return toMonacoTextEdits(edits)
    }
  })

  const onTypeOptions = lspCapability<{
    firstTriggerCharacter: string
    moreTriggerCharacter?: string[]
  }>(firstSession, 'documentOnTypeFormattingProvider')
  if (onTypeOptions) {
    monaco.languages.registerOnTypeFormattingEditProvider(languageId, {
      autoFormatTriggerCharacters: [
        onTypeOptions.firstTriggerCharacter,
        ...(onTypeOptions.moreTriggerCharacter ?? [])
      ],
      async provideOnTypeFormattingEdits(model, position, ch, options, token) {
        const binding = lspBindingFor(model)
        if (!binding || !lspCapability(binding.session, 'documentOnTypeFormattingProvider')) {
          return null
        }
        const edits = await requestLsp<TextEdit[] | null>(
          binding.session,
          'textDocument/onTypeFormatting',
          {
            ...lspPositionParams(binding, position),
            ch,
            options: { tabSize: options.tabSize, insertSpaces: options.insertSpaces }
          },
          token
        )
        return toMonacoTextEdits(edits)
      }
    })
  }

  const inlayHintsChanged = new monaco.Emitter<void>()
  onLspRefreshRequest('inlayHint', () => inlayHintsChanged.fire())
  monaco.languages.registerInlayHintsProvider(languageId, {
    onDidChangeInlayHints: inlayHintsChanged.event,
    async provideInlayHints(model, range, token) {
      const binding = lspBindingFor(model)
      if (!binding || !lspCapability(binding.session, 'inlayHintProvider')) {
        return null
      }
      const hints = await requestLsp<InlayHint[] | null>(
        binding.session,
        'textDocument/inlayHint',
        { textDocument: { uri: binding.uri }, range: toLspRange(range) },
        token
      )
      const lspHints = hints ?? []
      const monacoHints = toMonacoInlayHints(lspHints)
      monacoHints.forEach((hint, index) => {
        lspInlayHintByMonacoHint.set(hint, { hint: lspHints[index], binding })
      })
      return { hints: monacoHints, dispose: () => {} }
    },
    // Roslyn sends parameter/type hints bare and fills their hover tooltip on resolve.
    async resolveInlayHint(hint, token) {
      const stashed = lspInlayHintByMonacoHint.get(hint)
      if (
        !stashed ||
        hint.tooltip ||
        !lspCapability<{ resolveProvider?: boolean }>(stashed.binding.session, 'inlayHintProvider')
          ?.resolveProvider
      ) {
        return hint
      }
      const resolved = await requestLsp<InlayHint>(
        stashed.binding.session,
        'inlayHint/resolve',
        stashed.hint,
        token
      )
      return resolved?.tooltip ? { ...hint, tooltip: toMonacoMarkdown(resolved.tooltip)[0] } : hint
    }
  })
}
