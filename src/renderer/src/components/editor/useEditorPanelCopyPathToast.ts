import { useCallback, useRef, useState } from 'react'
import type { OpenFile } from '@/store/slices/editor'
import { getEditorHeaderCopyState } from './editor-header'

type CopiedPathToast = { fileId: string; token: number }

/** Copies the header path to the clipboard and drives the transient "copied" toast. */
export function useEditorPanelCopyPathToast(activeFile: OpenFile | null): {
  copiedPathToast: CopiedPathToast | null
  registerPanelNode: (node: HTMLDivElement | null) => void
  handleCopyPath: () => Promise<void>
} {
  const [copiedPathToast, setCopiedPathToast] = useState<CopiedPathToast | null>(null)
  const resetTimerRef = useRef<number | null>(null)
  // Why: clipboard IPC can resolve after the editor panel unmounts; skip path
  // toast feedback instead of starting a reset timer on a stale panel.
  const mountedRef = useRef(false)

  const clearResetTimer = useCallback((): void => {
    if (resetTimerRef.current === null) {
      return
    }
    window.clearTimeout(resetTimerRef.current)
    resetTimerRef.current = null
  }, [])

  const registerPanelNode = useCallback(
    (node: HTMLDivElement | null): void => {
      mountedRef.current = node !== null
      if (!node) {
        clearResetTimer()
      }
    },
    [clearResetTimer]
  )

  const handleCopyPath = useCallback(async (): Promise<void> => {
    if (!activeFile) {
      return
    }
    const copyState = getEditorHeaderCopyState(activeFile)
    if (!copyState.copyText) {
      return
    }
    try {
      await window.api.ui.writeClipboardText(copyState.copyText)
      if (!mountedRef.current) {
        return
      }
      clearResetTimer()
      const nextToast = { fileId: activeFile.id, token: Date.now() }
      setCopiedPathToast(nextToast)
      resetTimerRef.current = window.setTimeout(() => {
        resetTimerRef.current = null
        setCopiedPathToast((current) => (current?.token === nextToast.token ? null : current))
      }, 1500)
    } catch {
      if (!mountedRef.current) {
        return
      }
      clearResetTimer()
      setCopiedPathToast(null)
    }
  }, [activeFile, clearResetTimer])

  return { copiedPathToast, registerPanelNode, handleCopyPath }
}
