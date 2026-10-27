import React, { useCallback } from 'react'
import {
  Copy,
  Download,
  ExternalLink,
  Eye,
  File,
  FilePlus,
  Files,
  FolderPlus,
  Globe,
  ListCollapse,
  Pencil,
  Search,
  SquareTerminal,
  Trash2
} from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { useShortcutLabel } from '@/hooks/useShortcutLabel'
import { detectLanguage } from '@/lib/language-detect'
import { openFileInBrowserTab } from '@/lib/file-preview'
import { translate } from '@/i18n/i18n'
import type { RuntimeFileOperationArgs } from '@/runtime/runtime-file-client-types'
import { LocalOnlyMenuHint } from '@/components/local-only-menu-hint'
import {
  getRevealInFileManagerLabel,
  getWorkspaceFileRevealOwner,
  revealInFileManager
} from '@/lib/reveal-in-file-manager'
import { isRevealOrEditorOpenBlocked } from '@/lib/local-path-open-guard'
import { runtimeEnvironmentIdOrLocalUnlessTwin } from '@/lib/worktree-runtime-owner'
import type { TreeNode } from './file-explorer-types'
import {
  shouldShowCollapseFolderAction,
  shouldShowCopyFileAction,
  shouldShowFindInFolderAction,
  shouldShowOpenInTerminalAction,
  shouldShowRemoteDownloadAction,
  shouldShowViewFileAction
} from './file-explorer-row-action-visibility'
import { copyFileToOsClipboard, downloadRemoteFile } from './file-explorer-row-file-transfer'

const isMac = navigator.userAgent.includes('Mac')

/**
 * Menu primitive slots so the same items render inside a Radix ContextMenu
 * (legacy rows) or a DropdownMenu (the @pierre/trees pane).
 */
export type FileExplorerMenuPrimitives = {
  Item: React.ComponentType<{
    onSelect?: (event: Event) => void
    disabled?: boolean
    variant?: 'default' | 'destructive'
    children?: React.ReactNode
  }>
  Separator: React.ComponentType<object>
  Shortcut: React.ComponentType<{ children?: React.ReactNode }>
}

export type FileExplorerNodeMenuItemsProps = {
  menu: FileExplorerMenuPrimitives
  node: TreeNode
  isExpanded: boolean
  deleteShortcutLabel: string
  connectionId?: string | null
  runtimeDownloadContext?: RuntimeFileOperationArgs | null
  supportsFolderDownload?: boolean
  canOpenInOrcaBrowser: boolean
  canCollapseFolderSubtree: boolean
  /** Absolute directory New File / New Folder create into. */
  targetDir: string
  selectionSize: number
  onViewFile: () => void
  onCopyPaths: (pathKind: 'absolute' | 'relative') => void
  onStartNew: (type: 'file' | 'folder', parentAbsoluteDir: string) => void
  onStartRename: (node: TreeNode) => void
  onDuplicate: (node: TreeNode) => void
  onAddFolderAsProject: () => void
  canAddAsProject: boolean
  onOpenInTerminal: () => void
  onRequestDelete: () => void
  onCollapseFolderSubtree: () => void
  onFindInFolder: () => void
}

export function FileExplorerNodeMenuItems({
  menu,
  node,
  isExpanded,
  deleteShortcutLabel,
  connectionId,
  runtimeDownloadContext,
  supportsFolderDownload,
  canOpenInOrcaBrowser,
  canCollapseFolderSubtree,
  targetDir,
  selectionSize,
  onViewFile,
  onCopyPaths,
  onStartNew,
  onStartRename,
  onDuplicate,
  onAddFolderAsProject,
  canAddAsProject,
  onOpenInTerminal,
  onRequestDelete,
  onCollapseFolderSubtree,
  onFindInFolder
}: FileExplorerNodeMenuItemsProps): React.JSX.Element {
  const { Item, Separator, Shortcut } = menu
  const openMarkdownPreview = useAppStore((s) => s.openMarkdownPreview)
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const copyPathShortcutLabel = useShortcutLabel('fileExplorer.copyPath')
  const copyRelativePathShortcutLabel = useShortcutLabel('fileExplorer.copyRelativePath')
  const findInFolderShortcutLabel = useShortcutLabel('sidebar.search.toggle')
  const showRemoteDownloadAction = shouldShowRemoteDownloadAction(
    node,
    connectionId,
    runtimeDownloadContext,
    supportsFolderDownload
  )
  const showCopyFileAction = shouldShowCopyFileAction(node, connectionId, selectionSize)
  const revealOwner = useAppStore((s) =>
    getWorkspaceFileRevealOwner(s, s.activeWorktreeId, {
      connectionId,
      runtimeEnvironmentId: runtimeEnvironmentIdOrLocalUnlessTwin(s, s.activeWorktreeId)
    })
  )
  const revealBlocked = isRevealOrEditorOpenBlocked(revealOwner)
  const handleOpenInOrcaBrowser = useCallback(() => {
    if (!activeWorktreeId) {
      return
    }
    const result = openFileInBrowserTab({ filePath: node.path, worktreeId: activeWorktreeId })
    if (result.status === 'unsupported') {
      toast.error(result.message)
    }
  }, [activeWorktreeId, node.path])
  const handleDownload = useCallback(() => {
    const downloadTarget = connectionId || runtimeDownloadContext
    if (!downloadTarget) {
      return
    }
    void downloadRemoteFile(node, downloadTarget)
  }, [connectionId, node, runtimeDownloadContext])
  const handleCopyFile = useCallback(() => {
    void copyFileToOsClipboard(node, connectionId)
  }, [connectionId, node])

  return (
    <>
      <Item onSelect={() => onStartNew('file', targetDir)}>
        <FilePlus />
        {translate('auto.components.right.sidebar.FileExplorerRow.37c875d827', 'New File')}
      </Item>
      <Item onSelect={() => onStartNew('folder', targetDir)}>
        <FolderPlus />
        {translate('auto.components.right.sidebar.FileExplorerRow.f61af83316', 'New Folder')}
      </Item>
      <Separator />
      {showCopyFileAction && (
        <Item onSelect={handleCopyFile}>
          <Copy />
          {translate('auto.components.right.sidebar.FileExplorerRow.98a79948b3', 'Copy')}
        </Item>
      )}
      <Item onSelect={() => onCopyPaths('absolute')}>
        <Copy />
        {selectionSize > 1
          ? translate('auto.components.right.sidebar.FileExplorerRow.f9d7ca753d', 'Copy Paths')
          : translate('auto.components.right.sidebar.FileExplorerRow.b5d436aa30', 'Copy Path')}
        {copyPathShortcutLabel !== 'Unassigned' ? (
          <Shortcut>{copyPathShortcutLabel}</Shortcut>
        ) : null}
      </Item>
      <Item onSelect={() => onCopyPaths('relative')}>
        <Copy />
        {selectionSize > 1
          ? translate(
              'auto.components.right.sidebar.FileExplorerRow.42e10cbf57',
              'Copy Relative Paths'
            )
          : translate(
              'auto.components.right.sidebar.FileExplorerRow.66a29dde82',
              'Copy Relative Path'
            )}
        {copyRelativePathShortcutLabel !== 'Unassigned' ? (
          <Shortcut>{copyRelativePathShortcutLabel}</Shortcut>
        ) : null}
      </Item>
      {!node.isDirectory && (
        <Item onSelect={() => onDuplicate(node)}>
          <Files />
          {translate('auto.components.right.sidebar.FileExplorerRow.0fec99bfd7', 'Duplicate')}
        </Item>
      )}
      {canAddAsProject && (
        <Item onSelect={onAddFolderAsProject}>
          <FolderPlus />
          {translate(
            'auto.components.right.sidebar.FileExplorerRow.1bb9be455c',
            'Add as Project...'
          )}
        </Item>
      )}
      {shouldShowOpenInTerminalAction(node) && (
        <Item onSelect={onOpenInTerminal}>
          <SquareTerminal />
          {translate(
            'auto.components.right.sidebar.FileExplorerRow.e887fa4b2e',
            'Open in Terminal'
          )}
        </Item>
      )}
      {shouldShowViewFileAction(node) && (
        <Item onSelect={onViewFile}>
          <File />
          {translate('auto.components.right.sidebar.FileExplorerRow.1d8e182c32', 'View File')}
        </Item>
      )}
      {!node.isDirectory && activeWorktreeId && canOpenInOrcaBrowser && (
        <Item onSelect={handleOpenInOrcaBrowser}>
          <Globe />
          {translate(
            'auto.components.right.sidebar.FileExplorerRow.dd112c81d2',
            'Open in Orca Browser'
          )}
        </Item>
      )}
      {!node.isDirectory && activeWorktreeId && detectLanguage(node.path) === 'markdown' && (
        <Item
          onSelect={() =>
            openMarkdownPreview({
              filePath: node.path,
              relativePath: node.relativePath,
              worktreeId: activeWorktreeId,
              language: 'markdown'
            })
          }
        >
          <Eye />
          {translate(
            'auto.components.right.sidebar.FileExplorerRow.d87a4c42e1',
            'Open Markdown Preview'
          )}
        </Item>
      )}
      {showRemoteDownloadAction && (
        <Item onSelect={handleDownload}>
          <Download />
          {node.isDirectory
            ? translate(
                'auto.components.right.sidebar.FileExplorerRow.7ac885bd2f',
                'Download Folder'
              )
            : translate('auto.components.right.sidebar.FileExplorerRow.c2112579f6', 'Download')}
        </Item>
      )}
      {canCollapseFolderSubtree && shouldShowCollapseFolderAction(node, isExpanded) && (
        <Item onSelect={onCollapseFolderSubtree}>
          <ListCollapse />
          {translate('auto.components.right.sidebar.FileExplorerRow.d6a25618aa', 'Collapse Folder')}
        </Item>
      )}
      {shouldShowFindInFolderAction(node) && (
        <Item onSelect={onFindInFolder}>
          <Search />
          {translate('auto.components.right.sidebar.FileExplorerRow.0df0e5abac', 'Find in Folder')}
          {findInFolderShortcutLabel !== 'Unassigned' ? (
            <Shortcut>{findInFolderShortcutLabel}</Shortcut>
          ) : null}
        </Item>
      )}
      <Item
        disabled={revealBlocked}
        onSelect={() => void revealInFileManager(node.path, revealOwner)}
      >
        <ExternalLink />
        {getRevealInFileManagerLabel()}
        {revealBlocked ? <LocalOnlyMenuHint /> : null}
      </Item>
      <Separator />
      <Item onSelect={() => onStartRename(node)}>
        <Pencil />
        {translate('auto.components.right.sidebar.FileExplorerRow.fc747429bf', 'Rename')}
        <Shortcut>
          {isMac
            ? '↩'
            : translate('auto.components.right.sidebar.FileExplorerRow.a06551beee', 'Enter')}
        </Shortcut>
      </Item>
      <Item variant="destructive" onSelect={onRequestDelete}>
        <Trash2 />
        {translate('auto.components.right.sidebar.FileExplorerRow.addc01145f', 'Delete')}
        <Shortcut>{deleteShortcutLabel}</Shortcut>
      </Item>
    </>
  )
}
