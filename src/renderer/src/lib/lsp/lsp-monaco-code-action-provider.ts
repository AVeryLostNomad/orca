import type * as Monaco from 'monaco-editor'
import type { CodeAction, Command, Diagnostic, WorkspaceEdit } from 'vscode-languageserver-protocol'
import { requestLsp } from './lsp-client'
import type { LspDocumentBinding } from './lsp-document-binding'
import { toLspRange, toMonacoMarker } from './lsp-monaco-converters'
import { applyLspWorkspaceEdit, toMonacoWorkspaceEdit } from './lsp-monaco-workspace-edit'
import { lspBindingFor, lspCapability } from './lsp-provider-binding-access'

type MonacoModule = typeof Monaco

type LspCodeAction = CodeAction | Command

type CodeActionState = {
  action: CodeAction
  binding: LspDocumentBinding
  modelVersion: number
}

type CommandInvocation = {
  binding: LspDocumentBinding
  command: Command
  modelVersion?: number
}

const EXECUTE_LSP_COMMAND = 'orca.lsp.executeCommand'
const codeActionState = new WeakMap<Monaco.languages.CodeAction, CodeActionState>()
const registeredCommandMonacos = new WeakSet<object>()

function isWorkspaceEdit(value: unknown): value is WorkspaceEdit {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('changes' in value || 'documentChanges' in value)
  )
}

function toLspDiagnostic(marker: Monaco.editor.IMarkerData): Diagnostic {
  const severityByMarker: Record<number, 1 | 2 | 3 | 4> = { 8: 1, 4: 2, 2: 3, 1: 4 }
  return {
    range: toLspRange(marker),
    severity: severityByMarker[marker.severity] ?? 1,
    code: typeof marker.code === 'object' ? marker.code.value : marker.code,
    source: marker.source,
    message: marker.message,
    tags: marker.tags as (1 | 2)[] | undefined
  }
}
function isCurrentBinding(binding: LspDocumentBinding): boolean {
  return !binding.model.isDisposed() && lspBindingFor(binding.model) === binding
}

function toMonacoCodeAction(
  monaco: MonacoModule,
  binding: LspDocumentBinding,
  modelVersion: number,
  action: CodeAction
): Monaco.languages.CodeAction {
  const workspaceEdit = action.edit
    ? toMonacoWorkspaceEdit(monaco, binding.session, action.edit)
    : undefined
  const monacoAction: Monaco.languages.CodeAction = {
    title: action.title,
    kind: action.kind,
    isPreferred: action.isPreferred,
    diagnostics: action.diagnostics?.map(toMonacoMarker),
    disabled: action.disabled?.reason ?? workspaceEdit?.failureReason,
    ...(workspaceEdit?.workspaceEdit ? { edit: workspaceEdit.workspaceEdit } : {}),
    ...(action.command
      ? {
          command: {
            id: EXECUTE_LSP_COMMAND,
            title: action.command.title,
            arguments: [
              {
                binding,
                command: action.command,
                ...(action.edit ? {} : { modelVersion })
              } satisfies CommandInvocation
            ]
          }
        }
      : {})
  }
  codeActionState.set(monacoAction, { action, binding, modelVersion })
  return monacoAction
}

function isCodeAction(action: LspCodeAction): action is CodeAction {
  return typeof (action as Command).command !== 'string'
}

function installLspCommandExecutor(monaco: MonacoModule): void {
  if (registeredCommandMonacos.has(monaco)) {
    return
  }
  registeredCommandMonacos.add(monaco)
  monaco.editor.registerCommand(
    EXECUTE_LSP_COMMAND,
    async (_accessor, invocation: CommandInvocation) => {
      if (
        !invocation ||
        !isCurrentBinding(invocation.binding) ||
        (invocation.modelVersion !== undefined &&
          invocation.binding.model.getVersionId() !== invocation.modelVersion)
      ) {
        return
      }
      const result = await requestLsp<unknown>(
        invocation.binding.session,
        'workspace/executeCommand',
        invocation.command
      )
      if (isWorkspaceEdit(result)) {
        const applied = applyLspWorkspaceEdit(monaco, invocation.binding.session, result)
        if (!applied.applied) {
          throw new Error(applied.failureReason)
        }
      }
    }
  )
}

export function registerLspCodeActionProvider(monaco: MonacoModule, languageId: string): void {
  installLspCommandExecutor(monaco)
  monaco.languages.registerCodeActionProvider(
    languageId,
    {
      async provideCodeActions(model, range, context, token) {
        const binding = lspBindingFor(model)
        if (!binding || !lspCapability(binding.session, 'codeActionProvider')) {
          return null
        }
        const modelVersion = model.getVersionId()

        const actions = await requestLsp<LspCodeAction[] | null>(
          binding.session,
          'textDocument/codeAction',
          {
            textDocument: { uri: binding.uri },
            range: toLspRange(range),
            context: {
              diagnostics: context.markers.map(toLspDiagnostic),
              only: context.only ? [context.only] : undefined,
              triggerKind: context.trigger
            }
          },
          token
        )
        if (!actions || !isCurrentBinding(binding) || model.getVersionId() !== modelVersion) {
          return null
        }
        return {
          actions: actions.map((action) => {
            if (isCodeAction(action)) {
              return toMonacoCodeAction(monaco, binding, modelVersion, action)
            }
            const monacoAction = toMonacoCodeAction(monaco, binding, modelVersion, {
              title: action.title,
              command: action
            })
            codeActionState.delete(monacoAction)
            return monacoAction
          }),
          dispose: () => {}
        }
      },
      async resolveCodeAction(monacoAction, token) {
        const state = codeActionState.get(monacoAction)
        if (
          !state ||
          !isCurrentBinding(state.binding) ||
          state.binding.model.getVersionId() !== state.modelVersion ||
          !lspCapability<{ resolveProvider?: boolean }>(state.binding.session, 'codeActionProvider')
            ?.resolveProvider
        ) {
          return monacoAction
        }
        const resolved = await requestLsp<CodeAction>(
          state.binding.session,
          'codeAction/resolve',
          state.action,
          token
        )
        if (
          !resolved ||
          !isCurrentBinding(state.binding) ||
          state.binding.model.getVersionId() !== state.modelVersion
        ) {
          return monacoAction
        }
        return toMonacoCodeAction(monaco, state.binding, state.modelVersion, resolved)
      }
    },
    { providedCodeActionKinds: ['quickfix', 'refactor', 'source'] }
  )
}
