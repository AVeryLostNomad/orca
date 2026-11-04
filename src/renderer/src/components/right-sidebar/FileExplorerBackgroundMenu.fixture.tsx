import { defineFixture } from '../../component-fixtures/component-fixture'
import { FileExplorerBackgroundMenu } from './FileExplorerBackgroundMenu'
import type { TreeNode } from './file-explorer-types'
import type { FileTreeNodeCommands } from './use-file-tree-node-commands'

const rootNode: TreeNode = {
  name: 'orca',
  path: '/Users/me/code/orca',
  relativePath: '',
  isDirectory: true,
  depth: -1,
  operationOwner: { kind: 'local' }
}

const commands: FileTreeNodeCommands = {
  buildNode: () => null,
  rootNode,
  isNodeExpanded: () => true,
  deleteShortcutLabel: 'Delete',
  copyPathsForNode: () => {},
  handleStartRename: () => {},
  handleDuplicate: () => {},
  handlePaste: () => {},
  handleAddFolderAsProject: () => {},
  canAddAsProject: () => false,
  handleOpenInTerminal: () => {},
  handleContextMenuDelete: () => {},
  handleCollapseFolderSubtree: () => {},
  handleFindInFolder: () => {}
}

function renderMenu(): React.JSX.Element {
  return (
    <div className="h-[240px]">
      <FileExplorerBackgroundMenu
        open
        onOpenChange={() => {}}
        point={{ x: 8, y: 8 }}
        rootNode={rootNode}
        commands={commands}
        connectionId={null}
        runtimeDownloadContext={null}
        supportsFolderDownload={false}
        onStartNew={() => {}}
      />
    </div>
  )
}

// Right-clicking the empty area below the tree opens the root folder's menu.
export const withCopiedFiles = defineFixture({
  width: 300,
  setup: () => {
    window.api.ui.readClipboardFilePaths = async () => ['/Users/me/code/other-repo/README.md']
  },
  render: renderMenu
})

export const nothingCopied = defineFixture({
  width: 300,
  setup: () => {
    window.api.ui.readClipboardFilePaths = async () => []
  },
  render: renderMenu
})
