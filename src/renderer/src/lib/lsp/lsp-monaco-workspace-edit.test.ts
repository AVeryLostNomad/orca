// @vitest-environment happy-dom
import * as monaco from 'monaco-editor'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceEdit } from 'vscode-languageserver-protocol'
import { ensureLspDocumentBinding, type LspDocumentBinding } from './lsp-document-binding'
import type { LspSessionLease, LspWorkspaceSession } from './lsp-client'
import { applyLspWorkspaceEdit, toMonacoWorkspaceEdit } from './lsp-monaco-workspace-edit'

const models: monaco.editor.ITextModel[] = []
const bindings: LspDocumentBinding[] = []

function bindModel(content = 'const value = 1\n'): {
  model: monaco.editor.ITextModel
  session: LspWorkspaceSession
  uri: string
} {
  const model = monaco.editor.createModel(
    content,
    'typescript',
    monaco.Uri.parse('file:///repo/a.ts')
  )
  const session: LspWorkspaceSession = {
    serverId: 'typescript',
    rootPath: '/repo',
    sessionId: `test-${models.length}`,
    epoch: 1,
    capabilities: {},
    status: 'ready'
  }
  const lease: LspSessionLease = { session, release: vi.fn() }
  bindings.push(ensureLspDocumentBinding(model, lease, '/repo/a.ts', 'typescript', 'worktree'))
  models.push(model)
  return { model, session, uri: 'file:///repo/a.ts' }
}

afterEach(() => {
  for (const binding of bindings.splice(0)) {
    binding.dispose()
  }
  for (const model of models.splice(0)) {
    model.dispose()
  }
})

describe('LSP workspace edits', () => {
  it('applies server command edits as one undoable canonical-model operation', async () => {
    const { model, session, uri } = bindModel()
    const edit: WorkspaceEdit = {
      changes: {
        [uri]: [
          {
            range: { start: { line: 0, character: 14 }, end: { line: 0, character: 15 } },
            newText: '2'
          }
        ]
      }
    }
    expect(applyLspWorkspaceEdit(monaco, session, edit)).toEqual({ applied: true })
    expect(model.getValue()).toBe('const value = 2\n')
    await model.undo()
    expect(model.getValue()).toBe('const value = 1\n')
  })

  it('rejects stale versioned edits without changing the model', () => {
    const { model, session, uri } = bindModel()
    model.pushEditOperations([], [{ range: new monaco.Range(1, 15, 1, 16), text: '2' }], () => null)
    const edit: WorkspaceEdit = {
      documentChanges: [
        {
          textDocument: { uri, version: 1 },
          edits: [
            {
              range: { start: { line: 0, character: 14 }, end: { line: 0, character: 15 } },
              newText: '3'
            }
          ]
        }
      ]
    }

    expect(applyLspWorkspaceEdit(monaco, session, edit)).toMatchObject({ applied: false })
    expect(model.getValue()).toBe('const value = 2\n')
    expect(toMonacoWorkspaceEdit(monaco, session, edit)).toMatchObject({
      failureReason: expect.stringMatching(/older document version/)
    })
  })
})
