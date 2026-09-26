import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashMarkdownContent } from '../../../shared/mobile-markdown-document'
import { attachEditorAutosaveController } from '../components/editor/editor-autosave-controller'
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

describe('mobile markdown bridge save guards', () => {
  beforeEach(resetEditorState)
  afterEach(cleanupMobileMarkdownBridgeHarness)

  it('retains a failed mobile write as the dirty canonical document rather than restoring stale text', async () => {
    openMarkdownFile('desktop draft')
    setupWindow({
      readFile: vi.fn().mockResolvedValue({ content: 'desktop draft', isBinary: false }),
      writeFile: vi.fn().mockRejectedValue(new Error('disk full'))
    })
    const detachBridge = attachMobileMarkdownBridge()
    const detachAutosave = attachEditorAutosaveController(useAppStore as never)
    try {
      await expect(
        sendRequest({
          id: 'failed-save',
          operation: 'save',
          worktreeId: 'wt-1',
          tabId: 'tab-md',
          baseVersion: hashMarkdownContent('desktop draft'),
          content: 'mobile edit'
        })
      ).resolves.toMatchObject({ id: 'failed-save', ok: false })
      const document = Object.values(useAppStore.getState().workingDocuments)[0]
      expect(document).toMatchObject({ content: 'mobile edit', isDirty: true })
    } finally {
      detachAutosave()
      detachBridge()
    }
  })
})
