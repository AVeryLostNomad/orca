import { FileTree } from '@pierre/trees'
import type { FileTreeDropResult, FileTreeRenameEvent, FileTreeRenamingItem } from '@pierre/trees'
import { toast } from 'sonner'
import { FILE_EXPLORER_TREE_UNSAFE_CSS } from './file-explorer-tree-theme'

/** Matches the old drag-expand delay for hover-open during internal drags. */
const FILE_TREE_OPEN_ON_DROP_DELAY_MS = 500

type FileExplorerTreeCallbacks = {
  onSelectionChange: (paths: readonly string[]) => void
  canRename: (item: FileTreeRenamingItem) => boolean
  onRename: (event: FileTreeRenameEvent) => void
  canDrag: (paths: readonly string[]) => boolean
  onDropComplete: (event: FileTreeDropResult) => void
}

/** The explorer's @pierre/trees model, configured for Orca's own filter input and menus. */
export function createFileExplorerTree(callbacks: FileExplorerTreeCallbacks): FileTree {
  const created = new FileTree({
    paths: [],
    initialExpansion: 'closed',
    flattenEmptyDirectories: false,
    stickyFolders: false,
    // Why: Orca's own name-filter input drives model.setSearch(); the
    // library's built-in search UI stays off.
    search: false,
    fileTreeSearchMode: 'hide-non-matches',
    onSelectionChange: callbacks.onSelectionChange,
    renaming: {
      canRename: callbacks.canRename,
      onRename: callbacks.onRename,
      onError: (error) => toast.error(error)
    },
    dragAndDrop: {
      canDrag: callbacks.canDrag,
      onDropComplete: callbacks.onDropComplete,
      onDropError: (error) => toast.error(error),
      openOnDropDelay: FILE_TREE_OPEN_ON_DROP_DELAY_MS
    },
    composition: {
      contextMenu: {
        enabled: true,
        triggerMode: 'both',
        // Why: right-clicking outside the current multi-selection retargets
        // it, mirroring the old explorer's context-menu selection rules.
        onOpen: (item) => {
          if (!created.getSelectedPaths().includes(item.path)) {
            for (const selected of created.getSelectedPaths()) {
              created.getItem(selected)?.deselect()
            }
            created.getItem(item.path)?.select()
          }
        }
      }
    },
    unsafeCSS: FILE_EXPLORER_TREE_UNSAFE_CSS
  })
  return created
}
