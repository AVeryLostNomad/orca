// @vitest-environment happy-dom
import * as monaco from 'monaco-editor'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ensureLspDocumentBinding, type LspDocumentBinding } from './lsp-document-binding'
import type { LspSessionLease, LspWorkspaceSession } from './lsp-client'
import { isLspLocationPreviewModel, resolveLspLocationModels } from './lsp-location-models'

const bindings: LspDocumentBinding[] = []
const readFile = vi.fn()

const session: LspWorkspaceSession = {
  serverId: 'typescript',
  rootPath: '/repo',
  sessionId: 'location-models',
  epoch: 1,
  capabilities: {},
  status: 'ready'
}

function location(uri: string, line: number): monaco.languages.Location {
  return { uri: monaco.Uri.parse(uri), range: new monaco.Range(line, 1, line, 4) }
}

afterEach(() => {
  for (const binding of bindings.splice(0)) {
    binding.dispose()
  }
  for (const model of monaco.editor.getModels()) {
    model.dispose()
  }
  readFile.mockReset()
})

Object.assign(window, { api: { fs: { readFile } } })

describe('resolveLspLocationModels', () => {
  it('maps open documents to their editor model and previews unopened files from disk', async () => {
    const openModel = monaco.editor.createModel(
      'const fps = 1\n',
      'typescript',
      monaco.Uri.parse('orca-working-document:/repo/a.ts?doc')
    )
    const lease: LspSessionLease = { session, release: vi.fn() }
    bindings.push(ensureLspDocumentBinding(openModel, lease, '/repo/a.ts', 'typescript', 'wt'))
    readFile.mockResolvedValue({ content: 'use(fps)\n', isBinary: false })

    const resolved = await resolveLspLocationModels(monaco, session, [
      location('file:///repo/a.ts', 1),
      location('file:///repo/b.ts', 1),
      location('file:///repo/b.ts', 2)
    ])

    expect(resolved.map((entry) => entry.uri.toString())).toEqual([
      openModel.uri.toString(),
      'file:///repo/b.ts',
      'file:///repo/b.ts'
    ])
    expect(readFile).toHaveBeenCalledTimes(1)
    const preview = monaco.editor.getModel(monaco.Uri.parse('file:///repo/b.ts'))
    expect(preview?.getValue()).toBe('use(fps)\n')
    expect(isLspLocationPreviewModel(preview)).toBe(true)
    expect(isLspLocationPreviewModel(openModel)).toBe(false)
  })

  it('refreshes a cached preview from disk on the next request', async () => {
    readFile.mockResolvedValueOnce({ content: 'old\n', isBinary: false })
    await resolveLspLocationModels(monaco, session, [location('file:///repo/c.ts', 1)])
    readFile.mockResolvedValueOnce({ content: 'new\n', isBinary: false })
    await resolveLspLocationModels(monaco, session, [location('file:///repo/c.ts', 1)])

    expect(monaco.editor.getModel(monaco.Uri.parse('file:///repo/c.ts'))?.getValue()).toBe('new\n')
  })

  it('leaves unreadable files unresolved instead of creating an empty preview', async () => {
    readFile.mockRejectedValue(new Error('outside workspace'))

    const [resolved] = await resolveLspLocationModels(monaco, session, [
      location('file:///elsewhere/lib.d.ts', 1)
    ])

    expect(resolved?.uri.toString()).toBe('file:///elsewhere/lib.d.ts')
    expect(monaco.editor.getModel(resolved!.uri)).toBeNull()
  })
})
