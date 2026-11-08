import { describe, expect, it } from 'vitest'
import type { CompletionList } from 'vscode-languageserver-protocol'
import { lspCompletionItemsWithDefaults } from './lsp-completion-list'

const range = (start: number, end: number) => ({
  start: { line: 3, character: start },
  end: { line: 3, character: end }
})

describe('lspCompletionItemsWithDefaults', () => {
  it('folds Roslyn-style list defaults into each item without overriding item values', () => {
    const list: CompletionList = {
      isIncomplete: false,
      itemDefaults: {
        editRange: range(4, 7),
        data: { resultId: 9 },
        commitCharacters: ['.', '(']
      },
      items: [
        { label: 'Update', textEditText: 'Update()' },
        { label: 'Start' },
        {
          label: 'Awake',
          textEdit: { range: range(0, 7), newText: 'void Awake' },
          data: { own: true }
        },
        { label: 'nameof', commitCharacters: [] }
      ]
    }
    const [update, start, awake, keyword] = lspCompletionItemsWithDefaults(list, [' '])
    expect(update.textEdit).toEqual({ range: range(4, 7), newText: 'Update()' })
    expect(update.data).toEqual({ resultId: 9 })
    expect(start.textEdit).toEqual({ range: range(4, 7), newText: 'Start' })
    expect(start.commitCharacters).toEqual(['.', '('])
    expect(awake.textEdit).toEqual({ range: range(0, 7), newText: 'void Awake' })
    expect(awake.data).toEqual({ own: true })
    // An explicit empty list means "no commit characters", not "use the default".
    expect(keyword.commitCharacters).toEqual([])
  })

  it('expands an insert/replace default range and falls back to server-wide commit characters', () => {
    const [item] = lspCompletionItemsWithDefaults(
      {
        isIncomplete: true,
        itemDefaults: {
          editRange: { insert: range(4, 6), replace: range(4, 9) },
          insertTextFormat: 2
        },
        items: [{ label: 'GetComponent', insertText: 'GetComponent<$1>()' }]
      },
      [';']
    )
    expect(item.textEdit).toEqual({
      newText: 'GetComponent<$1>()',
      insert: range(4, 6),
      replace: range(4, 9)
    })
    expect(item.insertTextFormat).toBe(2)
    expect(item.commitCharacters).toEqual([';'])
  })
})
