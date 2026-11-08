import type * as Monaco from 'monaco-editor'
import type { Command, Position, TextEdit, WorkspaceEdit } from 'vscode-languageserver-protocol'
import { requestLsp } from './lsp-client'
import { getLspBindingForUri, type LspDocumentBinding } from './lsp-document-binding'
import { toMonacoRange } from './lsp-monaco-converters'
import { applyLspWorkspaceEdit } from './lsp-monaco-workspace-edit'
import { lspCapability } from './lsp-provider-binding-access'

type MonacoModule = typeof Monaco

/** `always`: legacy code-action behaviour (servers that execute unadvertised
 *  commands); `advertised`: only commands in executeCommandProvider.commands. */
export type LspServerCommandFallback = 'always' | 'advertised'

type LspCommandInvocation = {
  binding: LspDocumentBinding
  command: Command
  serverFallback: LspServerCommandFallback
}

type ClientCommandHandler = (
  monaco: MonacoModule,
  binding: LspDocumentBinding,
  args: unknown[]
) => void | Promise<void>

type SnippetController = Monaco.editor.IEditorContribution & {
  insert(template: string, options?: { adjustWhitespace?: boolean }): void
}

const LSP_CLIENT_COMMAND = 'orca.lsp.clientCommand'
const registeredMonacos = new WeakSet<object>()

function isWorkspaceEdit(value: unknown): value is WorkspaceEdit {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('changes' in value || 'documentChanges' in value)
  )
}

function isLspPosition(value: unknown): value is Position {
  return (
    typeof value === 'object' &&
    value !== null &&
    'line' in value &&
    typeof value.line === 'number' &&
    'character' in value &&
    typeof value.character === 'number'
  )
}

function isTextEdit(value: unknown): value is TextEdit {
  return (
    typeof value === 'object' &&
    value !== null &&
    'newText' in value &&
    typeof value.newText === 'string' &&
    'range' in value
  )
}

/** The editor showing `model`, preferring the focused one. */
export function lspEditorForModel(
  monaco: MonacoModule,
  model: Monaco.editor.ITextModel
): Monaco.editor.ICodeEditor | undefined {
  const editors = monaco.editor.getEditors().filter((editor) => editor.getModel() === model)
  return editors.find((editor) => editor.hasTextFocus()) ?? editors[0]
}

// Commands name their document by uri string or (Roslyn completion edits)
// TextDocumentIdentifier; fall back to the invoking document.
function bindingForUriArgument(binding: LspDocumentBinding, value: unknown): LspDocumentBinding {
  const uri =
    typeof value === 'string'
      ? value
      : typeof value === 'object' &&
          value !== null &&
          'uri' in value &&
          typeof value.uri === 'string'
        ? value.uri
        : undefined
  return (uri && getLspBindingForUri(binding.session.sessionId, uri)) || binding
}

// Roslyn's references lens: (uri, position[, locations]). VS Code-style
// servers emit editor.action.showReferences with the same shape.
function peekReferences(monaco: MonacoModule, binding: LspDocumentBinding, args: unknown[]): void {
  const target = bindingForUriArgument(binding, args[0])
  const position = args[1]
  const editor = lspEditorForModel(monaco, target.model)
  if (!editor || !isLspPosition(position)) {
    return
  }
  editor.setPosition({ lineNumber: position.line + 1, column: position.character + 1 })
  editor.focus()
  // An Action2 command (not exposed via getAction); it acts on the focused editor.
  editor.trigger('lsp', 'editor.action.referenceSearch.trigger', null)
}

/** Replace `range` in `editor`, as an undoable snippet (tab stops, `$0` caret)
 *  when requested and Monaco's snippet controller is available. */
export function applyLspEditorEdit(
  editor: Monaco.editor.ICodeEditor,
  range: Monaco.IRange,
  text: string,
  options: { snippet: boolean; adjustWhitespace?: boolean }
): void {
  const snippets = options.snippet
    ? editor.getContribution<SnippetController>('snippetController2')
    : null
  if (snippets) {
    editor.setSelection(range)
    snippets.insert(text, { adjustWhitespace: options.adjustWhitespace ?? true })
    return
  }
  editor.pushUndoStop()
  editor.executeEdits('lsp', [{ range, text }])
  editor.pushUndoStop()
}

// Roslyn computes override/partial-method completions at resolve time and
// applies them through this command after the placeholder insert.
function applyCompletionComplexEdit(
  monaco: MonacoModule,
  binding: LspDocumentBinding,
  args: unknown[]
): void {
  const [document, textEdit, isSnippet, newOffset] = args
  const target = bindingForUriArgument(binding, document)
  if (!isTextEdit(textEdit) || target.model.isDisposed()) {
    return
  }
  const range = toMonacoRange(textEdit.range)
  const editor = lspEditorForModel(monaco, target.model)
  if (!editor) {
    target.model.pushEditOperations([], [{ range, text: textEdit.newText }], () => null)
    return
  }
  applyLspEditorEdit(editor, range, textEdit.newText, { snippet: isSnippet === true })
  if (typeof newOffset === 'number' && newOffset >= 0) {
    editor.setPosition(target.model.getPositionAt(newOffset))
  }
}

const CLIENT_COMMAND_HANDLERS: Record<string, ClientCommandHandler> = {
  'roslyn.client.peekReferences': peekReferences,
  'editor.action.showReferences': peekReferences,
  'roslyn.client.completionComplexEdit': applyCompletionComplexEdit
}

/** Run a server-supplied Command: client-implemented commands first, then an
 *  advertised workspace/executeCommand, then a same-named Monaco editor action. */
export async function executeLspCommand(
  monaco: MonacoModule,
  binding: LspDocumentBinding,
  command: Command,
  serverFallback: LspServerCommandFallback
): Promise<void> {
  const handler = CLIENT_COMMAND_HANDLERS[command.command]
  if (handler) {
    await handler(monaco, binding, command.arguments ?? [])
    return
  }
  const advertised =
    lspCapability<{ commands?: string[] }>(
      binding.session,
      'executeCommandProvider'
    )?.commands?.includes(command.command) ?? false
  const editorAction = advertised
    ? null
    : lspEditorForModel(monaco, binding.model)?.getAction(command.command)
  if (editorAction) {
    await editorAction.run()
    return
  }
  if (!advertised && serverFallback === 'advertised') {
    return
  }
  const result = await requestLsp<unknown>(binding.session, 'workspace/executeCommand', {
    command: command.command,
    arguments: command.arguments
  })
  if (isWorkspaceEdit(result)) {
    const applied = applyLspWorkspaceEdit(monaco, binding.session, result)
    if (!applied.applied) {
      throw new Error(applied.failureReason)
    }
  }
}

function installLspClientCommand(monaco: MonacoModule): void {
  if (registeredMonacos.has(monaco)) {
    return
  }
  registeredMonacos.add(monaco)
  monaco.editor.registerCommand(
    LSP_CLIENT_COMMAND,
    (_accessor, invocation: LspCommandInvocation) => {
      if (!invocation || invocation.binding.model.isDisposed()) {
        return
      }
      return executeLspCommand(
        monaco,
        invocation.binding,
        invocation.command,
        invocation.serverFallback
      )
    }
  )
}

/** Wrap an LSP Command as a Monaco command (e.g. code lens titles). */
export function toMonacoLspCommand(
  monaco: MonacoModule,
  binding: LspDocumentBinding,
  command: Command,
  serverFallback: LspServerCommandFallback
): Monaco.languages.Command {
  installLspClientCommand(monaco)
  return {
    id: LSP_CLIENT_COMMAND,
    title: command.title,
    tooltip: command.tooltip,
    arguments: [{ binding, command, serverFallback } satisfies LspCommandInvocation]
  }
}
