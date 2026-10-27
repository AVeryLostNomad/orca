import { useEffect } from 'react'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'
import {
  ORCA_EDITOR_REQUEST_CMD_SAVE_EVENT,
  type EditorRequestCmdSaveDetail
} from './editor-autosave'

type UseEditorCmdSaveRequestParams = {
  /** The tab whose Cmd+S requests this panel answers. */
  ownerTabId: string | null
  activeDocumentId: WorkingDocumentId | null
  enabled: boolean
  isUntitled: boolean
  handleSave: () => Promise<boolean>
}

export function useEditorCmdSaveRequest({
  ownerTabId,
  activeDocumentId,
  enabled,
  isUntitled,
  handleSave
}: UseEditorCmdSaveRequestParams): void {
  useEffect(() => {
    if (!enabled) {
      return
    }
    const handler = (event: Event): void => {
      if ((event as CustomEvent<EditorRequestCmdSaveDetail>).detail?.tabId !== ownerTabId) {
        return
      }
      if (activeDocumentId || isUntitled) {
        void handleSave()
      }
    }
    window.addEventListener(ORCA_EDITOR_REQUEST_CMD_SAVE_EVENT, handler)
    return () => window.removeEventListener(ORCA_EDITOR_REQUEST_CMD_SAVE_EVENT, handler)
  }, [activeDocumentId, ownerTabId, enabled, handleSave, isUntitled])
}
