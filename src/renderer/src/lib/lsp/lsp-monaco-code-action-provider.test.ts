// @vitest-environment happy-dom
import * as monaco from 'monaco-editor'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LspDocumentBinding } from './lsp-document-binding'
import type { LspWorkspaceSession } from './lsp-client'

const state = vi.hoisted(() => ({
  binding: undefined as LspDocumentBinding | undefined,
  provider: undefined as monaco.languages.CodeActionProvider | undefined,
  request: vi.fn()
}))
vi.mock('./lsp-client', () => ({ requestLsp: state.request }))
vi.mock('./lsp-provider-binding-access', () => ({
  lspBindingFor: (model: monaco.editor.ITextModel) =>
    state.binding?.model === model ? state.binding : undefined,
  lspCapability: (session: LspWorkspaceSession, key: string) => session.capabilities[key]
}))

import { registerLspCodeActionProvider } from './lsp-monaco-code-action-provider'

let model: monaco.editor.ITextModel | undefined

afterEach(() => {
  model?.dispose()
  model = undefined
  state.binding = undefined
  state.provider = undefined
  state.request.mockReset()
})

describe('LSP Monaco code actions', () => {
  it('drops an action response that arrives after the model changes', async () => {
    model = monaco.editor.createModel('const value = 1\n', 'typescript')
    const session: LspWorkspaceSession = {
      serverId: 'typescript',
      rootPath: '/repo',
      sessionId: 'test',
      epoch: 1,
      capabilities: { codeActionProvider: true },
      status: 'ready'
    }
    state.binding = {
      session,
      model,
      uri: 'file:///repo/a.ts',
      filePath: '/repo/a.ts',
      worktreeId: 'worktree',
      lspVersion: () => 1,
      dispose: () => {}
    }
    const providerMonaco = {
      languages: {
        registerCodeActionProvider: (
          _languageId: string,
          provider: monaco.languages.CodeActionProvider
        ) => {
          state.provider = provider
          return { dispose: () => {} }
        }
      },
      editor: { registerCommand: () => ({ dispose: () => {} }) }
    } as unknown as typeof monaco
    const response = Promise.withResolvers<{ title: string }[]>()
    state.request.mockImplementationOnce(() => response.promise)
    registerLspCodeActionProvider(providerMonaco, 'typescript')

    const pending = state.provider!.provideCodeActions(
      model,
      new monaco.Range(1, 1, 1, 1),
      { markers: [], trigger: monaco.languages.CodeActionTriggerType.Invoke },
      { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) }
    ) as Promise<monaco.languages.CodeActionList | null>
    model.applyEdits([{ range: new monaco.Range(1, 15, 1, 16), text: '2' }])
    response.resolve([{ title: 'Stale action' }])

    await expect(pending).resolves.toBeNull()
  })
})
