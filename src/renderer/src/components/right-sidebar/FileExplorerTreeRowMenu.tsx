import React from 'react'
import { dirname } from '@/lib/path'
import type {
  ContextMenuItem as TreeContextMenuItem,
  ContextMenuOpenContext as TreeContextMenuOpenContext
} from '@pierre/trees'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import type { RuntimeFileOperationArgs } from '@/runtime/runtime-file-client-types'
import {
  FileExplorerNodeMenuItems,
  type FileExplorerMenuPrimitives
} from './file-explorer-node-menu-items'
import type { FileTreeNodeCommands } from './use-file-tree-node-commands'

export const FILE_EXPLORER_DROPDOWN_MENU_PRIMITIVES: FileExplorerMenuPrimitives = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Shortcut: DropdownMenuShortcut
}

type FileExplorerTreeRowMenuProps = {
  item: TreeContextMenuItem
  context: TreeContextMenuOpenContext
  commands: FileTreeNodeCommands
  selectionSize: number
  connectionId: string | null
  runtimeDownloadContext: RuntimeFileOperationArgs | null
  supportsFolderDownload: boolean
  canOpenInOrcaBrowser: (filePath: string) => boolean
  /** Opens a tree-model path as a preview tab. */
  openFilePreview: (treePath: string) => void
  onStartNew: (type: 'file' | 'folder', parentAbsoluteDir: string) => void
}

/**
 * Row context menu for the @pierre/trees pane. The library slots this near the
 * row; a fixed trigger at the anchor rect positions the Radix dropdown there.
 */
export function FileExplorerTreeRowMenu({
  item,
  context,
  commands,
  selectionSize,
  connectionId,
  runtimeDownloadContext,
  supportsFolderDownload,
  canOpenInOrcaBrowser,
  openFilePreview,
  onStartNew
}: FileExplorerTreeRowMenuProps): React.JSX.Element | null {
  const node = commands.buildNode(item.path, item.kind === 'directory')
  if (!node) {
    return null
  }
  // Why: creating or pasting from a file row targets its parent directory.
  const targetDir = node.isDirectory ? node.path : dirname(node.path)
  return (
    <DropdownMenu
      open
      onOpenChange={(open) => {
        if (!open) {
          context.close()
        }
      }}
      modal={false}
    >
      <DropdownMenuTrigger asChild>
        <button
          aria-hidden
          tabIndex={-1}
          className="pointer-events-none fixed size-px opacity-0"
          style={{ left: context.anchorRect.left, top: context.anchorRect.bottom }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        // Why: portaled menu clicks must not count as outside clicks for the tree.
        data-file-tree-context-menu-root="true"
        className="w-64 bg-[rgba(255,255,255,0.82)] dark:bg-[rgba(0,0,0,0.72)]"
        align="start"
        sideOffset={0}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <FileExplorerNodeMenuItems
          menu={FILE_EXPLORER_DROPDOWN_MENU_PRIMITIVES}
          node={node}
          connectionId={connectionId}
          runtimeDownloadContext={runtimeDownloadContext}
          supportsFolderDownload={supportsFolderDownload}
          canOpenInOrcaBrowser={canOpenInOrcaBrowser(node.path)}
          targetDir={targetDir}
          selectionSize={selectionSize}
          onStartNew={(type, parentAbsoluteDir) => {
            context.close({ restoreFocus: false })
            onStartNew(type, parentAbsoluteDir)
          }}
          onCopyPaths={(pathKind) => commands.copyPathsForNode(node, pathKind)}
          onOpenInTerminal={() => commands.handleOpenInTerminal(node)}
          onFindInFolder={() => commands.handleFindInFolder(node)}
          onPaste={() => commands.handlePaste(targetDir)}
          rowActions={{
            isExpanded: commands.isNodeExpanded(node),
            deleteShortcutLabel: commands.deleteShortcutLabel,
            canCollapseFolderSubtree: true,
            canAddAsProject: commands.canAddAsProject(node),
            onViewFile: () => openFilePreview(item.path),
            onStartRename: () => {
              // Why: focus must hand off to the inline rename input, not bounce
              // back to the row through the menu-close focus restore.
              context.close({ restoreFocus: false })
              commands.handleStartRename(node)
            },
            onDuplicate: () => commands.handleDuplicate(node),
            onAddFolderAsProject: () => commands.handleAddFolderAsProject(node),
            onRequestDelete: () => commands.handleContextMenuDelete(node),
            onCollapseFolderSubtree: () => commands.handleCollapseFolderSubtree(node)
          }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
