import type { editor } from 'monaco-editor'
import { resolveEditorFontFamily } from '@/lib/editor-font-zoom'
import type { EditorFontFamilySettings } from '@/lib/editor-font-zoom'
import { diffEditorScrollbarOptions } from './diff-editor-scrollbar-options'
import { buildDiffEditorWhitespaceOptions } from './diff-editor-whitespace-options'
import { buildDiffEditorWordWrapOptions } from './diff-editor-word-wrap-options'
import { monacoFindOptions } from './monaco-find-options'

type DiffViewerEditorOptionsSettings = EditorFontFamilySettings & {
  diffWordWrap?: boolean
  diffShowWhitespace?: boolean
}

type DiffViewerEditorOptionsInput = {
  editable: boolean
  sideBySide: boolean
  diffEditorFontSize: number
  settings: DiffViewerEditorOptionsSettings | null
}

export function buildDiffViewerEditorOptions({
  editable,
  sideBySide,
  diffEditorFontSize,
  settings
}: DiffViewerEditorOptionsInput): editor.IStandaloneDiffEditorConstructionOptions {
  return {
    readOnly: !editable,
    originalEditable: false,
    renderSideBySide: sideBySide,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    fontSize: diffEditorFontSize,
    fontFamily: resolveEditorFontFamily(settings),
    lineNumbers: 'on',
    ...buildDiffEditorWordWrapOptions(settings?.diffWordWrap),
    ...buildDiffEditorWhitespaceOptions(settings?.diffShowWhitespace),
    automaticLayout: true,
    renderOverviewRuler: true,
    scrollbar: diffEditorScrollbarOptions,
    padding: { top: 0 },
    find: monacoFindOptions
  }
}
