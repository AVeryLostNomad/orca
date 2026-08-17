import type React from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useState } from 'react'
import { CLOSE_ALL_CONTEXT_MENUS_EVENT } from '@/components/tab-bar/SortableTab'
import { resolveFileTreeRowFromEvent } from './use-file-tree-activation'

type UseFileExplorerBackgroundMenuResult = {
  bgMenuOpen: boolean
  setBgMenuOpen: Dispatch<SetStateAction<boolean>>
  bgMenuPoint: { x: number; y: number }
  handleBackgroundContextMenuCapture: (event: React.MouseEvent<HTMLDivElement>) => void
  handleBackgroundDoubleClick: (event: React.MouseEvent<HTMLDivElement>) => void
}

/** Empty-space interactions of the explorer surface: background menu and new-file double click. */
export function useFileExplorerBackgroundMenu({
  worktreePath,
  createPending,
  startNew
}: {
  worktreePath: string | null
  createPending: boolean
  startNew: (kind: 'file' | 'folder', parentAbsoluteDir: string) => void
}): UseFileExplorerBackgroundMenuResult {
  const [bgMenuOpen, setBgMenuOpen] = useState(false)
  const [bgMenuPoint, setBgMenuPoint] = useState({ x: 0, y: 0 })

  const handleBackgroundContextMenuCapture = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      // Why: row right-clicks belong to the library's own context menu.
      if (resolveFileTreeRowFromEvent(event.nativeEvent)) {
        return
      }
      event.preventDefault()
      window.dispatchEvent(new Event(CLOSE_ALL_CONTEXT_MENUS_EVENT))
      setBgMenuPoint({ x: event.clientX, y: event.clientY })
      setBgMenuOpen(true)
    },
    []
  )

  const handleBackgroundDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!worktreePath || createPending) {
        return
      }
      if (resolveFileTreeRowFromEvent(event.nativeEvent)) {
        return
      }
      startNew('file', worktreePath)
    },
    [createPending, startNew, worktreePath]
  )

  return {
    bgMenuOpen,
    setBgMenuOpen,
    bgMenuPoint,
    handleBackgroundContextMenuCapture,
    handleBackgroundDoubleClick
  }
}
