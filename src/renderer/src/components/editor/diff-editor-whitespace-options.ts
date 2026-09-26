import type { editor } from 'monaco-editor'

export function buildDiffEditorWhitespaceOptions(
  _diffShowWhitespace: boolean | undefined
): Pick<editor.IStandaloneDiffEditorConstructionOptions, 'ignoreTrimWhitespace'> {
  // Semantic filtering is performed by the shared provider. Monaco's generic
  // trimming would hide meaningful whitespace before that policy can inspect it.
  return { ignoreTrimWhitespace: false }
}
