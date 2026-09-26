import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashMarkdownContent } from '../../../shared/mobile-markdown-document'
import { attachEditorAutosaveController } from '../components/editor/editor-autosave-controller'
import { registerPendingEditorFlush } from '../components/editor/editor-pending-flush'
import { useAppStore } from '../store'
import { attachMobileMarkdownBridge } from './mobile-markdown-bridge'
import {
  cleanupMobileMarkdownBridgeHarness,
  openMarkdownFile,
  resetEditorState,
  sendRequest,
  setupWindow
} from './mobile-markdown-bridge-test-harness'

vi.mock('@/components/tab-bar/group-tab-order', () => ({
  getActiveTabNavOrder: () => [{ type: 'editor', id: '/repo/README.md', tabId: 'tab-md' }]
}))
vi.mock('@/lib/connection-context', () => ({ getConnectionIdForFile: () => null }))

describe('mobile markdown bridge', () => {
  beforeEach(resetEditorState)
  afterEach(cleanupMobileMarkdownBridgeHarness)

  it('flushes a revision-matched rich producer into the canonical document before mobile reads', async () => {
    openMarkdownFile('before')
    setupWindow({ readFile: vi.fn() })
    const document = Object.values(useAppStore.getState().workingDocuments)[0]!
    const unregister = registerPendingEditorFlush(document.id, 'rich', document.revision, () => {
      useAppStore.getState().setWorkingDocumentContent(document.id, '# pending\n')
    })
    const detach = attachMobileMarkdownBridge()
    try {
      await expect(
        sendRequest({ id: 'read', operation: 'read', worktreeId: 'wt-1', tabId: 'tab-md' })
      ).resolves.toMatchObject({
        ok: true,
        result: { content: '# pending\n', source: 'draft' }
      })
    } finally {
      unregister()
      detach()
    }
  })

  it('writes the mobile edit through the canonical document queue and verifies disk bytes', async () => {
    openMarkdownFile('before')
    const writeFile = vi.fn().mockResolvedValue(undefined)
    setupWindow({
      readFile: vi.fn().mockResolvedValue({ content: 'mobile', isBinary: false }),
      writeFile
    })
    const detachBridge = attachMobileMarkdownBridge()
    const detachAutosave = attachEditorAutosaveController(useAppStore as never)
    try {
      await expect(
        sendRequest({
          id: 'save',
          operation: 'save',
          worktreeId: 'wt-1',
          tabId: 'tab-md',
          baseVersion: hashMarkdownContent('before'),
          content: 'mobile'
        })
      ).resolves.toMatchObject({ ok: true, result: { content: 'mobile', isDirty: false } })
      expect(writeFile).toHaveBeenCalled()
      expect(Object.values(useAppStore.getState().workingDocuments)[0]?.content).toBe('mobile')
    } finally {
      detachAutosave()
      detachBridge()
    }
  })
})
