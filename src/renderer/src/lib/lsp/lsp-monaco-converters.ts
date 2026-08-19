import type * as Monaco from 'monaco-editor'
import type {
  CompletionItem,
  Diagnostic,
  DocumentHighlight,
  DocumentSymbol,
  FoldingRange,
  Hover,
  InlayHint,
  Location,
  LocationLink,
  MarkupContent,
  Position,
  Range,
  SignatureHelp,
  SymbolInformation,
  TextEdit
} from 'vscode-languageserver-protocol'

type MonacoModule = typeof Monaco

export function toLspPosition(position: Monaco.IPosition): Position {
  return { line: position.lineNumber - 1, character: position.column - 1 }
}

export function toLspRange(range: Monaco.IRange): Range {
  return {
    start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
    end: { line: range.endLineNumber - 1, character: range.endColumn - 1 }
  }
}

export function toMonacoRange(range: Range): Monaco.IRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1
  }
}

const MARKER_SEVERITY_BY_LSP: Record<number, Monaco.MarkerSeverity> = {
  1: 8 as Monaco.MarkerSeverity, // Error
  2: 4 as Monaco.MarkerSeverity, // Warning
  3: 2 as Monaco.MarkerSeverity, // Info
  4: 1 as Monaco.MarkerSeverity // Hint
}

export function toMonacoMarker(diagnostic: Diagnostic): Monaco.editor.IMarkerData {
  const range = toMonacoRange(diagnostic.range)
  const code =
    typeof diagnostic.code === 'object' && diagnostic.code !== null
      ? String((diagnostic.code as { value?: unknown }).value ?? '')
      : diagnostic.code !== undefined
        ? String(diagnostic.code)
        : undefined
  const message = diagnostic.message
  return {
    severity: MARKER_SEVERITY_BY_LSP[diagnostic.severity ?? 1] ?? (8 as Monaco.MarkerSeverity),
    // 3.18 allows MarkupContent messages; markers want plain strings.
    message: typeof message === 'string' ? message : (message as { value: string }).value,
    source: diagnostic.source,
    code,
    startLineNumber: range.startLineNumber,
    startColumn: range.startColumn,
    endLineNumber: range.endLineNumber,
    endColumn: range.endColumn,
    tags: diagnostic.tags as Monaco.MarkerTag[] | undefined
  }
}

export function toMonacoMarkdown(
  content: MarkupContent | string | (string | { language: string; value: string })[] | undefined
): Monaco.IMarkdownString[] {
  if (!content) {
    return []
  }
  if (typeof content === 'string') {
    return [{ value: content }]
  }
  if (Array.isArray(content)) {
    return content.map((entry) =>
      typeof entry === 'string'
        ? { value: entry }
        : { value: `\`\`\`${entry.language}\n${entry.value}\n\`\`\`` }
    )
  }
  if (content.kind === 'plaintext') {
    return [{ value: content.value.replace(/[\\`*_{}[\]()#+\-.!]/g, '\\$&') }]
  }
  return [{ value: content.value }]
}

export function toMonacoHover(hover: Hover | null | undefined): Monaco.languages.Hover | undefined {
  if (!hover) {
    return undefined
  }
  return {
    contents: toMonacoMarkdown(hover.contents as MarkupContent),
    range: hover.range ? toMonacoRange(hover.range) : undefined
  }
}

// Both enums follow the same order; LSP is 1-based, Monaco CompletionItemKind
// is its own permutation, so map explicitly.
const COMPLETION_KIND_BY_LSP: Record<number, number> = {
  1: 18, // Text
  2: 0, // Method
  3: 1, // Function
  4: 2, // Constructor
  5: 3, // Field
  6: 4, // Variable
  7: 5, // Class
  8: 7, // Interface
  9: 8, // Module
  10: 9, // Property
  11: 12, // Unit
  12: 13, // Value
  13: 15, // Enum
  14: 17, // Keyword
  15: 27, // Snippet
  16: 19, // Color
  17: 20, // File
  18: 21, // Reference
  19: 23, // Folder
  20: 16, // EnumMember
  21: 14, // Constant
  22: 6, // Struct
  23: 10, // Event
  24: 11, // Operator
  25: 24 // TypeParameter
}

export function toMonacoCompletionItem(
  item: CompletionItem,
  defaultRange: Monaco.IRange
): Monaco.languages.CompletionItem {
  let range: Monaco.languages.CompletionItem['range'] = defaultRange
  let insertText = item.insertText ?? item.label
  const textEdit = item.textEdit
  if (textEdit) {
    insertText = textEdit.newText
    range =
      'range' in textEdit
        ? toMonacoRange(textEdit.range)
        : {
            insert: toMonacoRange(textEdit.insert),
            replace: toMonacoRange(textEdit.replace)
          }
  }
  const documentation = item.documentation
    ? toMonacoMarkdown(item.documentation as MarkupContent)[0]
    : undefined
  return {
    label: item.labelDetails
      ? {
          label: item.label,
          detail: item.labelDetails.detail,
          description: item.labelDetails.description
        }
      : item.label,
    kind: (COMPLETION_KIND_BY_LSP[item.kind ?? 1] ?? 18) as Monaco.languages.CompletionItemKind,
    detail: item.detail,
    documentation,
    sortText: item.sortText,
    filterText: item.filterText,
    preselect: item.preselect,
    insertText,
    // 4 = InsertAsSnippet
    insertTextRules:
      item.insertTextFormat === 2
        ? (4 as Monaco.languages.CompletionItemInsertTextRule)
        : undefined,
    range,
    tags: item.tags as Monaco.languages.CompletionItemTag[] | undefined,
    additionalTextEdits: item.additionalTextEdits?.map((edit) => ({
      range: toMonacoRange(edit.range),
      text: edit.newText
    })),
    commitCharacters: item.commitCharacters
  }
}

export function toMonacoSignatureHelp(
  help: SignatureHelp | null | undefined
): Monaco.languages.SignatureHelp | undefined {
  if (!help) {
    return undefined
  }
  return {
    activeSignature: help.activeSignature ?? 0,
    activeParameter: help.activeParameter ?? 0,
    signatures: help.signatures.map((signature) => ({
      label: signature.label,
      documentation: signature.documentation
        ? toMonacoMarkdown(signature.documentation as MarkupContent)[0]
        : undefined,
      activeParameter: signature.activeParameter ?? undefined,
      parameters: (signature.parameters ?? []).map((parameter) => ({
        label: parameter.label,
        documentation: parameter.documentation
          ? toMonacoMarkdown(parameter.documentation as MarkupContent)[0]
          : undefined
      }))
    }))
  }
}

export function toMonacoLocations(
  monaco: MonacoModule,
  result: Location | Location[] | LocationLink[] | null | undefined
): Monaco.languages.Location[] {
  if (!result) {
    return []
  }
  const entries = Array.isArray(result) ? result : [result]
  return entries.map((entry) => {
    if ('targetUri' in entry) {
      return {
        uri: monaco.Uri.parse(entry.targetUri),
        range: toMonacoRange(entry.targetSelectionRange ?? entry.targetRange)
      }
    }
    return { uri: monaco.Uri.parse(entry.uri), range: toMonacoRange(entry.range) }
  })
}

const HIGHLIGHT_KIND_BY_LSP: Record<number, number> = { 1: 0, 2: 1, 3: 2 }

export function toMonacoDocumentHighlights(
  highlights: DocumentHighlight[] | null | undefined
): Monaco.languages.DocumentHighlight[] {
  return (highlights ?? []).map((highlight) => ({
    range: toMonacoRange(highlight.range),
    kind: (HIGHLIGHT_KIND_BY_LSP[highlight.kind ?? 1] ??
      0) as Monaco.languages.DocumentHighlightKind
  }))
}

function isDocumentSymbolArray(
  symbols: DocumentSymbol[] | SymbolInformation[]
): symbols is DocumentSymbol[] {
  return symbols.length === 0 || 'range' in symbols[0]
}

function toMonacoDocumentSymbol(symbol: DocumentSymbol): Monaco.languages.DocumentSymbol {
  return {
    name: symbol.name || '<unnamed>',
    detail: symbol.detail ?? '',
    kind: (symbol.kind - 1) as Monaco.languages.SymbolKind,
    tags: (symbol.tags ?? []) as Monaco.languages.SymbolTag[],
    range: toMonacoRange(symbol.range),
    selectionRange: toMonacoRange(symbol.selectionRange),
    children: symbol.children?.map(toMonacoDocumentSymbol)
  }
}

export function toMonacoDocumentSymbols(
  symbols: DocumentSymbol[] | SymbolInformation[] | null | undefined
): Monaco.languages.DocumentSymbol[] {
  if (!symbols || symbols.length === 0) {
    return []
  }
  if (isDocumentSymbolArray(symbols)) {
    return symbols.map(toMonacoDocumentSymbol)
  }
  return symbols.map((symbol) => ({
    name: symbol.name || '<unnamed>',
    detail: '',
    kind: (symbol.kind - 1) as Monaco.languages.SymbolKind,
    tags: [] as Monaco.languages.SymbolTag[],
    range: toMonacoRange(symbol.location.range),
    selectionRange: toMonacoRange(symbol.location.range)
  }))
}

const FOLDING_KIND_BY_LSP: Record<string, Monaco.languages.FoldingRangeKind> = {
  comment: { value: 'comment' },
  imports: { value: 'imports' },
  region: { value: 'region' }
}

export function toMonacoFoldingRanges(
  ranges: FoldingRange[] | null | undefined
): Monaco.languages.FoldingRange[] {
  return (ranges ?? []).map((range) => ({
    start: range.startLine + 1,
    end: range.endLine + 1,
    kind: range.kind ? FOLDING_KIND_BY_LSP[range.kind] : undefined
  }))
}

export function toMonacoTextEdits(
  edits: TextEdit[] | null | undefined
): Monaco.languages.TextEdit[] {
  return (edits ?? []).map((edit) => ({
    range: toMonacoRange(edit.range),
    text: edit.newText
  }))
}

export function toMonacoInlayHints(
  hints: InlayHint[] | null | undefined
): Monaco.languages.InlayHint[] {
  return (hints ?? []).map((hint) => ({
    position: { lineNumber: hint.position.line + 1, column: hint.position.character + 1 },
    label:
      typeof hint.label === 'string' ? hint.label : hint.label.map((part) => part.value).join(''),
    kind: hint.kind as Monaco.languages.InlayHintKind | undefined,
    paddingLeft: hint.paddingLeft,
    paddingRight: hint.paddingRight,
    tooltip: hint.tooltip ? toMonacoMarkdown(hint.tooltip as MarkupContent)[0] : undefined
  }))
}
