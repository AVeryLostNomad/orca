// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const editorProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))

vi.mock('@monaco-editor/react', () => ({
  default: (props: Record<string, unknown>) => {
    editorProps.current = props
    return null
  },
  loader: { config: vi.fn() }
}))
vi.mock('@/store', () => {
  const state = (): Record<string, unknown> => ({
    settings: { theme: 'dark', terminalFontSize: 13, terminalFontFamily: 'monospace' },
    editorFontZoomLevel: 0,
    setPendingEditorReveal: vi.fn(),
    setEditorCursorLine: vi.fn(),
    addDiffComment: vi.fn(),
    deleteDiffComment: vi.fn(),
    updateDiffComment: vi.fn(),
    scrollToDiffCommentId: null,
    setScrollToDiffCommentId: vi.fn(),
    worktreeDiffComments: {}
  })
  const useAppStore = (selector: (state: Record<string, unknown>) => unknown): unknown =>
    selector(state())
  // Why: the theme controller and LSP hook read the store imperatively.
  useAppStore.getState = state
  useAppStore.subscribe = () => () => {}
  return { useAppStore }
})
vi.mock('../diff-comments/useDiffCommentDecorator', () => ({
  useDiffCommentDecorator: vi.fn()
}))
vi.mock('./useContextualCopySetup', () => ({
  useContextualCopySetup: () => ({ setupCopy: vi.fn(), toastNode: null })
}))

import MonacoEditor from './MonacoEditor'

afterEach(() => {
  cleanup()
  editorProps.current = null
})

describe('MonacoEditor content ownership', () => {
  it('initializes the wrapper without a controlled value updater', () => {
    render(
      <MonacoEditor
        fileId="file"
        filePath="/repo/file.jsonl"
        viewStateKey="pane:file"
        relativePath="file.jsonl"
        content="initial content"
        language="jsonl"
        onContentChange={vi.fn()}
        onSave={vi.fn()}
        readOnly
      />
    )

    expect(editorProps.current?.defaultValue).toBe('initial content')
    expect(editorProps.current).not.toHaveProperty('value')
  })
})
