// @vitest-environment happy-dom
import * as monaco from 'monaco-editor'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LspSessionEvent } from '../../../../shared/lsp-types'
import type { LspTransport } from './lsp-transport'

const transport = vi.hoisted(() => ({
  requests: [] as {
    method: string
    params: { previousResultId?: string; textDocument: { uri: string } }
  }[],
  replies: [] as unknown[],
  responses: [] as { serverRequestId: number; result: unknown }[],
  emit: (() => {}) as (sessionId: string, event: LspSessionEvent) => void
}))

vi.mock('./lsp-ipc-transport', () => ({
  getLspIpcTransport: (): LspTransport => ({
    ensureSession: async () => ({
      ok: true,
      sessionId: 's1',
      status: 'ready',
      epoch: 1,
      serverCapabilities: { diagnosticProvider: { interFileDependencies: false } }
    }),
    releaseSession: async () => {},
    request: async (_sessionId, _clientRequestId, method, params) => {
      transport.requests.push({ method, params: params as never })
      return { ok: true, result: transport.replies.shift() ?? null }
    },
    cancelRequest: () => {},
    notify: () => {},
    respondToServerRequest: (_sessionId, serverRequestId, result) => {
      transport.responses.push({ serverRequestId, result })
    },
    onEvent: (listener) => {
      transport.emit = listener
      return () => {}
    }
  })
}))

import { acquireLspSession } from './lsp-client'
import { ensureLspDocumentBinding } from './lsp-document-binding'
import { ensureLspPullDiagnostics } from './lsp-pull-diagnostics'
import { ensureLspDiagnosticsSubscription } from './lsp-diagnostics-markers'

const diagnostic = (message: string, line: number) => ({
  range: { start: { line, character: 0 }, end: { line, character: 1 } },
  severity: 1,
  message
})

function markerMessages(model: monaco.editor.ITextModel): string[] {
  return monaco.editor
    .getModelMarkers({ resource: model.uri, owner: 'lsp:csharp' })
    .map((marker) => marker.message)
}

async function bind(path: string, text: string) {
  const lease = await acquireLspSession('csharp', '/repo')
  const model = monaco.editor.createModel(text, 'csharp', monaco.Uri.file(path))
  const binding = ensureLspDocumentBinding(model, lease!, path, 'csharp', 'wt')
  return { model, binding }
}

const pulls = () =>
  transport.requests.filter((request) => request.method === 'textDocument/diagnostic')

beforeEach(() => {
  vi.useFakeTimers()
  transport.requests.length = 0
  transport.replies.length = 0
  transport.responses.length = 0
})

afterEach(() => {
  for (const model of monaco.editor.getModels()) {
    model.dispose()
  }
  vi.useRealTimers()
})

describe('LSP pull diagnostics', () => {
  it('keeps markers on an unchanged report and sends the previous result id', async () => {
    const { model, binding } = await bind('/repo/A.cs', 'class A {}\n')
    transport.replies.push({ kind: 'full', resultId: 'r1', items: [diagnostic('first', 0)] })
    ensureLspPullDiagnostics(monaco, binding)
    await vi.advanceTimersByTimeAsync(500)
    expect(markerMessages(model)).toEqual(['first'])

    transport.replies.push({ kind: 'unchanged', resultId: 'r2' })
    model.applyEdits([{ range: new monaco.Range(1, 1, 1, 1), text: ' ' }])
    // Debounced: nothing goes out on the keystroke itself.
    expect(pulls()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(500)
    expect(pulls()).toHaveLength(2)
    expect(pulls()[1].params.previousResultId).toBe('r1')
    expect(markerMessages(model)).toEqual(['first'])

    transport.replies.push({ kind: 'full', resultId: 'r3', items: [] })
    model.applyEdits([{ range: new monaco.Range(1, 1, 1, 1), text: ' ' }])
    await vi.advanceTimersByTimeAsync(500)
    expect(pulls()[2].params.previousResultId).toBe('r2')
    expect(markerMessages(model)).toEqual([])
  })

  it('applies relatedDocuments to other open documents and re-pulls on refresh', async () => {
    const a = await bind('/repo/B.cs', 'class B {}\n')
    const b = await bind('/repo/C.cs', 'class C {}\n')
    transport.replies.push({ kind: 'full', resultId: 'b1', items: [] })
    ensureLspPullDiagnostics(monaco, b.binding)
    await vi.advanceTimersByTimeAsync(500)
    transport.replies.push({
      kind: 'full',
      resultId: 'a1',
      items: [diagnostic('in A', 0)],
      // Servers may echo a URI in another encoding (Roslyn: file:///c:/ vs c%3A).
      relatedDocuments: {
        [b.binding.uri.replace('C.cs', '%43.cs')]: {
          kind: 'full',
          resultId: 'b2',
          items: [diagnostic('in B', 0)]
        }
      }
    })
    ensureLspPullDiagnostics(monaco, a.binding)
    await vi.advanceTimersByTimeAsync(500)
    expect(markerMessages(a.model)).toEqual(['in A'])
    expect(markerMessages(b.model)).toEqual(['in B'])

    transport.replies.push(
      { kind: 'unchanged', resultId: 'a2' },
      { kind: 'unchanged', resultId: 'b3' }
    )
    transport.emit('s1', {
      kind: 'serverRequest',
      serverRequestId: 7,
      method: 'workspace/diagnostic/refresh',
      params: null
    })
    await vi.advanceTimersByTimeAsync(500)
    expect(transport.responses).toEqual([{ serverRequestId: 7, result: null }])
    const refreshed = pulls().slice(-2)
    expect(
      Object.fromEntries(
        refreshed.map((r) => [r.params.textDocument.uri, r.params.previousResultId])
      )
    ).toEqual({ [a.binding.uri]: 'a1', [b.binding.uri]: 'b2' })
  })
  it('keeps pushed and pulled diagnostics side by side in one owner', async () => {
    const { model, binding } = await bind('/repo/D.cs', 'class D {}\n')
    ensureLspDiagnosticsSubscription(monaco, binding.session)
    transport.replies.push({ kind: 'full', resultId: 'd1', items: [diagnostic('pulled', 0)] })
    ensureLspPullDiagnostics(monaco, binding)
    await vi.advanceTimersByTimeAsync(500)
    transport.emit('s1', {
      kind: 'notification',
      method: 'textDocument/publishDiagnostics',
      params: { uri: binding.uri, diagnostics: [diagnostic('pushed', 0)] }
    })
    expect(markerMessages(model).sort()).toEqual(['pulled', 'pushed'])
    transport.emit('s1', {
      kind: 'notification',
      method: 'textDocument/publishDiagnostics',
      params: { uri: binding.uri, diagnostics: [] }
    })
    expect(markerMessages(model)).toEqual(['pulled'])
  })
})
