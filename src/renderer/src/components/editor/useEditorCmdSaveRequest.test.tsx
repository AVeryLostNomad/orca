// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCA_EDITOR_REQUEST_CMD_SAVE_EVENT } from './editor-autosave'
import { useEditorCmdSaveRequest } from './useEditorCmdSaveRequest'

type ProbeProps = Omit<Parameters<typeof useEditorCmdSaveRequest>[0], 'handleSave'> & {
  onSave: () => Promise<boolean>
}

function SaveProbe({ onSave, ...props }: ProbeProps): null {
  useEditorCmdSaveRequest({ ...props, handleSave: onSave })
  return null
}

describe('useEditorCmdSaveRequest', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.body.appendChild(document.createElement('div'))
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('routes a command save only to the matching visible tab document', () => {
    const save = vi.fn(async () => true)
    const otherSave = vi.fn(async () => true)
    act(() => {
      root.render(
        <>
          <SaveProbe
            activeTabId="tab-a"
            activeDocumentId={'document-a' as never}
            enabled
            isUntitled={false}
            onSave={save}
          />
          <SaveProbe
            activeTabId="tab-b"
            activeDocumentId={'document-b' as never}
            enabled
            isUntitled={false}
            onSave={otherSave}
          />
        </>
      )
    })
    act(() => {
      window.dispatchEvent(
        new CustomEvent(ORCA_EDITOR_REQUEST_CMD_SAVE_EVENT, { detail: { tabId: 'tab-a' } })
      )
    })
    expect(save).toHaveBeenCalledOnce()
    expect(otherSave).not.toHaveBeenCalled()
  })

  it('allows an untitled tab to route Cmd/Ctrl+S to its rename-aware save callback', () => {
    const save = vi.fn(async () => false)
    act(() => {
      root.render(
        <SaveProbe
          activeTabId="untitled"
          activeDocumentId={null}
          enabled
          isUntitled
          onSave={save}
        />
      )
    })
    act(() => {
      window.dispatchEvent(
        new CustomEvent(ORCA_EDITOR_REQUEST_CMD_SAVE_EVENT, { detail: { tabId: 'untitled' } })
      )
    })
    expect(save).toHaveBeenCalledOnce()
  })
})
