import type * as Monaco from 'monaco-editor'
import type { Command, TextEdit } from 'vscode-languageserver-protocol'
import { requestLsp } from './lsp-client'
import { applyLspEditorEdit, executeLspCommand } from './lsp-client-commands'
import type { LspDocumentBinding } from './lsp-document-binding'
import { toLspPosition, toMonacoRange } from './lsp-monaco-converters'
import { lspCapability } from './lsp-provider-binding-access'

type MonacoModule = typeof Monaco

type AutoInsertResponse = {
  _vs_textEditFormat?: number
  _vs_textEdit?: TextEdit
  command?: Command
}

const DOC_COMMENT_OPENER = /^\s*\/\/\/$/
const DOC_COMMENT_LINE = /^\s*\/\/\//

/** The `_vs_ch` trigger for a typed change, or null when this change should
 *  not ask the server. Only doc-comment typing qualifies: the third `/` of a
 *  `///` opener, or Enter on a `///` line. */
function docCommentAutoInsertTrigger(
  changeText: string,
  lineBeforeCaret: string,
  previousLine: string | null
): '/' | '\n' | null {
  let trigger = changeText.replace(/[^\S\n]+/g, '')
  // Enter can arrive as "\n" plus indentation, or two newlines between braces.
  if (trigger.length > 0 && trigger.trim() === '') {
    trigger = '\n'
  }
  if (trigger === '/') {
    return DOC_COMMENT_OPENER.test(lineBeforeCaret) ? '/' : null
  }
  if (trigger === '\n') {
    return previousLine !== null && DOC_COMMENT_LINE.test(previousLine) ? '\n' : null
  }
  return null
}

/** Rider/VS-style `///` expansion via Roslyn's textDocument/_vs_onAutoInsert.
 *  Gated on the server advertising `_vs_onAutoInsertProvider`. */
export function attachLspDocCommentAutoInsert(
  monaco: MonacoModule,
  editor: Monaco.editor.ICodeEditor,
  binding: LspDocumentBinding
): Monaco.IDisposable | null {
  const triggers = lspCapability<{ _vs_triggerCharacters?: string[] }>(
    binding.session,
    '_vs_onAutoInsertProvider'
  )?._vs_triggerCharacters
  if (!triggers?.includes('/') && !triggers?.includes('\n')) {
    return null
  }
  let inFlight: Monaco.CancellationTokenSource | null = null
  const contentSub = editor.onDidChangeModelContent(async (event) => {
    const { model } = binding
    if (
      editor.getModel() !== model ||
      !editor.hasTextFocus() ||
      event.isUndoing ||
      event.isRedoing ||
      event.isFlush ||
      event.changes.length !== 1
    ) {
      return
    }
    const change = event.changes[0]
    if (change.rangeLength !== 0 || change.range.startLineNumber !== change.range.endLineNumber) {
      return
    }
    const start = { lineNumber: change.range.startLineNumber, column: change.range.startColumn }
    const caret = model.getPositionAt(model.getOffsetAt(start) + change.text.length)
    const trigger = docCommentAutoInsertTrigger(
      change.text,
      model.getLineContent(caret.lineNumber).slice(0, caret.column - 1),
      caret.lineNumber > 1 ? model.getLineContent(caret.lineNumber - 1) : null
    )
    if (!trigger || !triggers.includes(trigger)) {
      return
    }
    inFlight?.cancel()
    const source = new monaco.CancellationTokenSource()
    inFlight = source
    const versionId = model.getVersionId()
    const { tabSize, insertSpaces } = model.getOptions()
    // Let the binding's didChange for this keystroke go out first.
    await Promise.resolve()
    const response = await requestLsp<AutoInsertResponse | null>(
      binding.session,
      'textDocument/_vs_onAutoInsert',
      {
        _vs_textDocument: { uri: binding.uri },
        _vs_position: toLspPosition(caret),
        _vs_ch: trigger,
        _vs_options: { tabSize, insertSpaces }
      },
      source.token
    )
    if (inFlight === source) {
      inFlight = null
    }
    source.dispose()
    const textEdit = response?._vs_textEdit
    if (!textEdit || model.isDisposed() || model.getVersionId() !== versionId) {
      return
    }
    // Roslyn pre-formats the snippet; Monaco must not re-indent it.
    applyLspEditorEdit(editor, toMonacoRange(textEdit.range), textEdit.newText, {
      snippet: response._vs_textEditFormat === 2,
      adjustWhitespace: false
    })
    if (response.command) {
      await executeLspCommand(monaco, binding, response.command, 'advertised')
    }
  })
  return {
    dispose: () => {
      inFlight?.cancel()
      contentSub.dispose()
    }
  }
}
