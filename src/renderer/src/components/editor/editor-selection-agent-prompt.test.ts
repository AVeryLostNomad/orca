import { describe, expect, it } from 'vitest'
import { buildEditorSelectionAgentPrompt } from './editor-selection-agent-prompt'

describe('buildEditorSelectionAgentPrompt', () => {
  it('formats question, path range, and fenced code', () => {
    const prompt = buildEditorSelectionAgentPrompt({
      question: 'Why does this loop twice?',
      relativePath: 'src/lib/thing.ts',
      startLine: 10,
      endLine: 12,
      language: 'typescript',
      selectedText: 'for (const x of xs) {\n  run(x)\n}\n'
    })
    expect(prompt).toBe(
      'Why does this loop twice?\n\n' +
        'Context — src/lib/thing.ts:10-12\n\n' +
        '```typescript\nfor (const x of xs) {\n  run(x)\n}\n```'
    )
  })

  it('collapses single-line ranges and omits an empty question', () => {
    const prompt = buildEditorSelectionAgentPrompt({
      question: '   ',
      relativePath: 'main.go',
      startLine: 4,
      endLine: 4,
      language: 'go',
      selectedText: 'fmt.Println("hi")'
    })
    expect(prompt).toBe('Context — main.go:4\n\n```go\nfmt.Println("hi")\n```')
  })

  it('grows the fence when the selection contains backtick fences', () => {
    const prompt = buildEditorSelectionAgentPrompt({
      question: 'Explain',
      relativePath: 'README.md',
      startLine: 1,
      endLine: 3,
      language: 'markdown',
      selectedText: '````\ncode\n````'
    })
    expect(prompt).toContain('`````markdown\n')
    expect(prompt.endsWith('`````')).toBe(true)
  })

  it('drops the language tag for plaintext', () => {
    const prompt = buildEditorSelectionAgentPrompt({
      question: 'What is this?',
      relativePath: 'notes.txt',
      startLine: 1,
      endLine: 1,
      language: 'plaintext',
      selectedText: 'hello'
    })
    expect(prompt).toContain('```\nhello\n```')
  })
})
