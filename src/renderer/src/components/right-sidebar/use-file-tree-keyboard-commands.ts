import { useCallback } from 'react'
import type React from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { getShortcutPlatform } from '@/lib/shortcut-platform'
import { keybindingMatchesAction } from '../../../../shared/keybindings'
import { translate } from '@/i18n/i18n'
import {
  fileExplorerHasRedo,
  fileExplorerHasUndo,
  redoFileExplorer,
  undoFileExplorer
} from './fileExplorerUndoRedo'
import { normalizeTreeRelativePath } from './file-explorer-tree-relative-paths'
import type { TreeNode } from './file-explorer-types'
import type { FileTreeModelLike } from './use-file-explorer-tree-model'
import type { FileTreeNodeCommands } from './use-file-tree-node-commands'

type UseFileTreeKeyboardCommandsParams = {
  model: FileTreeModelLike | null
  commands: FileTreeNodeCommands
  /** True while an inline rename/create editor owns the keyboard. */
  isRenameActive: () => boolean
}

function isComposedEditableTarget(event: React.KeyboardEvent): boolean {
  const target = event.nativeEvent.composedPath()[0]
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

/**
 * Explorer command shortcuts on the tree wrapper: rename (Enter), delete,
 * copy-path chords, and explorer undo/redo. Arrow-key navigation stays native
 * to @pierre/trees.
 */
export function useFileTreeKeyboardCommands({
  model,
  commands,
  isRenameActive
}: UseFileTreeKeyboardCommandsParams): (event: React.KeyboardEvent<HTMLDivElement>) => void {
  const keybindings = useAppStore((s) => s.keybindings)

  return useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!model || isRenameActive() || isComposedEditableTarget(event)) {
        return
      }
      const platform = getShortcutPlatform()
      const nativeEvent = event.nativeEvent

      const wantUndo =
        keybindingMatchesAction('fileExplorer.undo', nativeEvent, platform, keybindings) &&
        fileExplorerHasUndo()
      const wantRedo =
        keybindingMatchesAction('fileExplorer.redo', nativeEvent, platform, keybindings) &&
        fileExplorerHasRedo()
      if (wantUndo || wantRedo) {
        event.preventDefault()
        const run = wantRedo ? redoFileExplorer() : undoFileExplorer()
        void run.catch((err: unknown) => {
          toast.error(
            err instanceof Error
              ? err.message
              : translate(
                  'auto.components.right.sidebar.useFileExplorerKeys.8adb953095',
                  'Operation failed'
                )
          )
        })
        return
      }

      const buildFocusedNode = (): TreeNode | null => {
        const focusedPath = model.getFocusedPath()
        if (!focusedPath) {
          return null
        }
        const relative = normalizeTreeRelativePath(focusedPath)
        const item = model.getItem(relative)
        return item ? commands.buildNode(relative, item.isDirectory()) : null
      }

      if (
        event.key === 'Enter' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey
      ) {
        const node = buildFocusedNode()
        if (node) {
          event.preventDefault()
          commands.handleStartRename(node)
        }
        return
      }

      if (keybindingMatchesAction('fileExplorer.delete', nativeEvent, platform, keybindings)) {
        const node = buildFocusedNode() ?? buildFirstSelectedNode(model, commands)
        if (node) {
          event.preventDefault()
          commands.handleContextMenuDelete(node)
        }
        return
      }

      const wantsCopyRelativePath = keybindingMatchesAction(
        'fileExplorer.copyRelativePath',
        nativeEvent,
        platform,
        keybindings
      )
      const wantsCopyPath = keybindingMatchesAction(
        'fileExplorer.copyPath',
        nativeEvent,
        platform,
        keybindings
      )
      if (wantsCopyRelativePath || wantsCopyPath) {
        const node = buildFocusedNode() ?? buildFirstSelectedNode(model, commands)
        if (node) {
          event.preventDefault()
          commands.copyPathsForNode(node, wantsCopyRelativePath ? 'relative' : 'absolute')
        }
      }
    },
    [commands, isRenameActive, keybindings, model]
  )
}

function buildFirstSelectedNode(
  model: FileTreeModelLike,
  commands: FileTreeNodeCommands
): TreeNode | null {
  for (const selected of model.getSelectedPaths()) {
    const relative = normalizeTreeRelativePath(selected)
    const item = model.getItem(relative)
    const node = item ? commands.buildNode(relative, item.isDirectory()) : null
    if (node) {
      return node
    }
  }
  return null
}
