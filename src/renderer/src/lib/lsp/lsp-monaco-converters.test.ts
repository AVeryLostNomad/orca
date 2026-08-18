import { describe, expect, it } from 'vitest'
import type { CompletionItem, Diagnostic } from 'vscode-languageserver-protocol'
import {
  toLspPosition,
  toLspRange,
  toMonacoCompletionItem,
  toMonacoDocumentHighlights,
  toMonacoDocumentSymbols,
  toMonacoFoldingRanges,
  toMonacoInlayHints,
  toMonacoMarker,
  toMonacoRange,
  toMonacoSignatureHelp
} from './lsp-monaco-converters'

describe('position/range conversion', () => {
  it('round-trips between 1-based Monaco and 0-based LSP', () => {
    const monacoRange = { startLineNumber: 3, startColumn: 5, endLineNumber: 4, endColumn: 1 }
    const lspRange = toLspRange(monacoRange)
    expect(lspRange).toEqual({ start: { line: 2, character: 4 }, end: { line: 3, character: 0 } })
    expect(toMonacoRange(lspRange)).toEqual(monacoRange)
    expect(toLspPosition({ lineNumber: 1, column: 1 })).toEqual({ line: 0, character: 0 })
  })
})

describe('toMonacoMarker', () => {
  it('maps severity, code objects, and tags', () => {
    const diagnostic: Diagnostic = {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
      message: 'unused variable',
      severity: 2,
      source: 'ts',
      code: { value: 6133, target: 'https://example.invalid' } as never,
      tags: [1]
    }
    const marker = toMonacoMarker(diagnostic)
    expect(marker.severity).toBe(4)
    expect(marker.code).toBe('6133')
    expect(marker.source).toBe('ts')
    expect(marker.tags).toEqual([1])
    expect(marker.startLineNumber).toBe(1)
  })

  it('defaults missing severity to error', () => {
    const marker = toMonacoMarker({
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      message: 'boom'
    })
    expect(marker.severity).toBe(8)
  })
})

describe('toMonacoCompletionItem', () => {
  const defaultRange = { startLineNumber: 1, startColumn: 2, endLineNumber: 1, endColumn: 5 }

  it('prefers the textEdit range and text over insertText', () => {
    const item: CompletionItem = {
      label: 'toString',
      kind: 2,
      insertText: 'WRONG',
      textEdit: {
        range: { start: { line: 0, character: 1 }, end: { line: 0, character: 4 } },
        newText: 'toString()'
      }
    }
    const converted = toMonacoCompletionItem(item, defaultRange)
    expect(converted.insertText).toBe('toString()')
    expect(converted.range).toEqual({
      startLineNumber: 1,
      startColumn: 2,
      endLineNumber: 1,
      endColumn: 5
    })
    expect(converted.kind).toBe(0)
  })

  it('maps insert/replace edits and snippet format', () => {
    const item: CompletionItem = {
      label: 'log',
      kind: 3,
      insertTextFormat: 2,
      textEdit: {
        newText: 'log($1)',
        insert: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } },
        replace: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }
      }
    }
    const converted = toMonacoCompletionItem(item, defaultRange)
    expect(converted.insertTextRules).toBe(4)
    expect(converted.range).toEqual({
      insert: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 3 },
      replace: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6 }
    })
  })

  it('falls back to label text and default range', () => {
    const converted = toMonacoCompletionItem({ label: 'foo' }, defaultRange)
    expect(converted.insertText).toBe('foo')
    expect(converted.range).toBe(defaultRange)
  })
})

describe('toMonacoSignatureHelp', () => {
  it('converts signatures with parameter docs and null activeParameter', () => {
    const converted = toMonacoSignatureHelp({
      activeSignature: 0,
      activeParameter: null as never,
      signatures: [
        {
          label: 'fn(a: string)',
          activeParameter: null as never,
          parameters: [{ label: 'a: string', documentation: 'the a' }]
        }
      ]
    })
    expect(converted?.signatures[0]?.parameters[0]?.label).toBe('a: string')
    expect(converted?.signatures[0]?.activeParameter).toBeUndefined()
  })
})

describe('symbols, folding, highlights, inlay hints', () => {
  it('converts hierarchical document symbols with kind offset', () => {
    const symbols = toMonacoDocumentSymbols([
      {
        name: 'MyClass',
        kind: 5,
        range: { start: { line: 0, character: 0 }, end: { line: 10, character: 0 } },
        selectionRange: { start: { line: 0, character: 6 }, end: { line: 0, character: 13 } },
        children: [
          {
            name: 'method',
            kind: 6,
            range: { start: { line: 1, character: 2 }, end: { line: 3, character: 2 } },
            selectionRange: { start: { line: 1, character: 2 }, end: { line: 1, character: 8 } }
          }
        ]
      }
    ])
    expect(symbols[0]?.kind).toBe(4)
    expect(symbols[0]?.children?.[0]?.name).toBe('method')
  })

  it('converts flat SymbolInformation', () => {
    const symbols = toMonacoDocumentSymbols([
      {
        name: 'thing',
        kind: 13,
        location: {
          uri: 'file:///x.ts',
          range: { start: { line: 4, character: 0 }, end: { line: 4, character: 5 } }
        }
      }
    ])
    expect(symbols[0]?.range.startLineNumber).toBe(5)
  })

  it('converts folding ranges to 1-based lines', () => {
    const ranges = toMonacoFoldingRanges([{ startLine: 0, endLine: 4, kind: 'imports' }])
    expect(ranges[0]).toMatchObject({ start: 1, end: 5, kind: { value: 'imports' } })
  })

  it('maps highlight kinds down one', () => {
    const highlights = toMonacoDocumentHighlights([
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } }, kind: 3 }
    ])
    expect(highlights[0]?.kind).toBe(2)
  })

  it('joins inlay hint label parts', () => {
    const hints = toMonacoInlayHints([
      {
        position: { line: 2, character: 7 },
        label: [{ value: ': ' }, { value: 'string' }],
        kind: 1,
        paddingLeft: true
      }
    ])
    expect(hints[0]).toMatchObject({
      position: { lineNumber: 3, column: 8 },
      label: ': string',
      kind: 1,
      paddingLeft: true
    })
  })
})
