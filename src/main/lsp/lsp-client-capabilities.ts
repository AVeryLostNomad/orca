// Static capabilities covering every provider the renderer registers. Servers
// downgrade gracefully around anything Monaco later ignores.
export const LSP_CLIENT_CAPABILITIES = {
  general: {
    positionEncodings: ['utf-16']
  },
  workspace: {
    configuration: true,
    workspaceFolders: true,
    applyEdit: true,
    workspaceEdit: { documentChanges: true, resourceOperations: [] },
    didChangeConfiguration: {},
    didChangeWatchedFiles: { dynamicRegistration: false },
    symbol: {}
  },
  textDocument: {
    synchronization: { didSave: true, willSave: false, willSaveWaitUntil: false },
    publishDiagnostics: {
      relatedInformation: true,
      tagSupport: { valueSet: [1, 2] },
      codeDescriptionSupport: true,
      dataSupport: true
    },
    completion: {
      contextSupport: true,
      completionItem: {
        snippetSupport: true,
        commitCharactersSupport: false,
        documentationFormat: ['markdown', 'plaintext'],
        deprecatedSupport: true,
        insertReplaceSupport: true,
        resolveSupport: { properties: ['documentation', 'detail', 'additionalTextEdits'] },
        labelDetailsSupport: true
      },
      completionItemKind: { valueSet: Array.from({ length: 25 }, (_, index) => index + 1) }
    },
    hover: { contentFormat: ['markdown', 'plaintext'] },
    signatureHelp: {
      signatureInformation: {
        documentationFormat: ['markdown', 'plaintext'],
        parameterInformation: { labelOffsetSupport: true },
        activeParameterSupport: true
      },
      contextSupport: true
    },
    definition: {},
    typeDefinition: {},
    implementation: {},
    declaration: {},
    references: {},
    documentHighlight: {},
    documentSymbol: { hierarchicalDocumentSymbolSupport: true },
    codeAction: {
      codeActionLiteralSupport: {
        codeActionKind: {
          valueSet: [
            '',
            'quickfix',
            'refactor',
            'refactor.extract',
            'refactor.inline',
            'refactor.rewrite',
            'source',
            'source.organizeImports',
            'source.fixAll'
          ]
        }
      },
      resolveSupport: { properties: ['edit'] },
      dataSupport: true
    },
    formatting: {},
    rangeFormatting: {},
    onTypeFormatting: {},
    rename: { prepareSupport: true },
    documentLink: { tooltipSupport: true },
    foldingRange: { lineFoldingOnly: false },
    semanticTokens: {
      requests: { full: { delta: true }, range: false },
      tokenTypes: [
        'namespace',
        'type',
        'class',
        'enum',
        'interface',
        'struct',
        'typeParameter',
        'parameter',
        'variable',
        'property',
        'enumMember',
        'event',
        'function',
        'method',
        'macro',
        'keyword',
        'modifier',
        'comment',
        'string',
        'number',
        'regexp',
        'operator',
        'decorator'
      ],
      tokenModifiers: [
        'declaration',
        'definition',
        'readonly',
        'static',
        'deprecated',
        'abstract',
        'async',
        'modification',
        'documentation',
        'defaultLibrary'
      ],
      formats: ['relative'],
      multilineTokenSupport: false,
      overlappingTokenSupport: false
    },
    inlayHint: { resolveSupport: { properties: ['tooltip', 'label.tooltip'] } }
  },
  window: {
    workDoneProgress: true
  }
}
