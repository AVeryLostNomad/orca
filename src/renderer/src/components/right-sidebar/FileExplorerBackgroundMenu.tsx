import React, { useEffect } from 'react'
import { CLOSE_ALL_CONTEXT_MENUS_EVENT } from '@/lib/close-all-context-menus'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import type { RuntimeFileOperationArgs } from '@/runtime/runtime-file-client-types'
import { FileExplorerNodeMenuItems } from './file-explorer-node-menu-items'
import type { TreeNode } from './file-explorer-types'
import { FILE_EXPLORER_DROPDOWN_MENU_PRIMITIVES } from './FileExplorerTreeRowMenu'
import type { FileTreeNodeCommands } from './use-file-tree-node-commands'

function stopRightButtonMenuSelection(event: React.PointerEvent): void {
  if (event.button !== 2) {
    return
  }
  // Right-button release over the cursor-positioned trigger must not immediately select New File.
  event.preventDefault()
  event.stopPropagation()
}

/** Empty-area context menu: the folder menu for the workspace root, minus row-only actions. */
export function FileExplorerBackgroundMenu({
  open,
  onOpenChange,
  point,
  rootNode,
  commands,
  connectionId,
  runtimeDownloadContext,
  supportsFolderDownload,
  onStartNew
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  point: { x: number; y: number }
  rootNode: TreeNode
  commands: FileTreeNodeCommands
  connectionId: string | null
  runtimeDownloadContext: RuntimeFileOperationArgs | null
  supportsFolderDownload: boolean
  onStartNew: (type: 'file' | 'folder', parentAbsoluteDir: string) => void
}): React.JSX.Element {
  useEffect(() => {
    const close = (): void => onOpenChange(false)
    window.addEventListener(CLOSE_ALL_CONTEXT_MENUS_EVENT, close)
    return () => window.removeEventListener(CLOSE_ALL_CONTEXT_MENUS_EVENT, close)
  }, [onOpenChange])

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          aria-hidden
          tabIndex={-1}
          className="pointer-events-none fixed size-px opacity-0"
          style={{ left: point.x, top: point.y }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        // Why: portaled menu clicks must not count as outside clicks for the tree.
        data-file-tree-context-menu-root="true"
        className="w-64"
        sideOffset={0}
        align="start"
        onPointerUpCapture={stopRightButtonMenuSelection}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <FileExplorerNodeMenuItems
          menu={FILE_EXPLORER_DROPDOWN_MENU_PRIMITIVES}
          node={rootNode}
          connectionId={connectionId}
          runtimeDownloadContext={runtimeDownloadContext}
          supportsFolderDownload={supportsFolderDownload}
          canOpenInOrcaBrowser={false}
          targetDir={rootNode.path}
          selectionSize={1}
          onStartNew={onStartNew}
          onCopyPaths={(pathKind) => commands.copyPathsForNode(rootNode, pathKind)}
          onOpenInTerminal={() => commands.handleOpenInTerminal(rootNode)}
          onFindInFolder={() => commands.handleFindInFolder(rootNode)}
          onPaste={() => commands.handlePaste(rootNode.path)}
          rowActions={null}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
