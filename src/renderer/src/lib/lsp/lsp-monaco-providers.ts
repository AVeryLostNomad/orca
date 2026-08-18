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
  toMonacoSignatureHelp,
  toMonacoTextEdits
} from './lsp-monaco-converters'
import { lspBindingFor, lspCapability, lspPositionParams } from './lsp-provider-binding-access'
import { registerLspCompletionProvider } from './lsp-monaco-completion-provider'
import { registerLspRenameProvider } from './lsp-monaco-rename-provider'
import { registerLspSemanticTokensProvider } from './lsp-monaco-semantic-tokens-provider'

type MonacoModule = typeof Monaco

const providersByLanguage = new Set<string>()

/** Register the full provider suite for a Monaco language id (idempotent).
 *  Providers resolve the model's binding at call time, so any number of
 *  workspaces/sessions share one registration. */
export function ensureLspProvidersForLanguage(
  monaco: MonacoModule,
  languageId: string,
  firstSession: LspWorkspaceSession
): void {
  if (providersByLanguage.has(languageId)) {
    return
  }
  providersByLanguage.add(languageId)

  registerLspCompletionProvider(monaco, languageId, firstSession)
  registerLspRenameProvider(monaco, languageId)
  registerLspSemanticTokensProvider(monaco, languageId, firstSession)

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
      return toMonacoLocations(monaco, result)
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

  monaco.languages.registerInlayHintsProvider(languageId, {
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
      return { hints: toMonacoInlayHints(hints), dispose: () => {} }
    }
  })
}
