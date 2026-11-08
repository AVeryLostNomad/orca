import { useEffect, useState } from 'react'
import { FileTree as FileTreeView } from '@pierre/trees/react'
import type { FileTree } from '@pierre/trees'
import { defineFixture } from '../../component-fixtures/component-fixture'
import { getUnityExplorerScopeOptions } from '@/components/unity/unity-explorer-scope'
import { createFileExplorerTree } from './create-file-explorer-tree'
import { FILE_EXPLORER_FULL_ROOT } from './file-explorer-display-root'
import { FILE_EXPLORER_TREE_HOST_STYLE } from './file-explorer-tree-theme'
import { scopeTreeInputPaths } from './file-explorer-tree-scope'
import { FileExplorerToolbar } from './FileExplorerToolbar'
import { FileExplorerUnityScopeSelect } from './FileExplorerUnityScopeSelect'
import { resetFileTreePathsWithExpansion } from './use-file-tree-expansion-sync'

const WORKSPACE = 'C:/Unity/PieceExploration'

// A Unity project root as the listing reports it (worktree-relative, dirs end in '/').
const PROJECT_LISTING = [
  'Assets/',
  'Assets/Materials/',
  'Assets/Prefabs/',
  'Assets/Scenes/',
  'Assets/Scenes/Main.unity',
  'Assets/Scripts/',
  'Assets/Scripts/PlayerController.cs',
  'Assets/Scripts/PieceSpawner.cs',
  'Assets/Settings/',
  'Library/',
  'Logs/',
  'obj/',
  'Packages/',
  'Packages/manifest.json',
  'Packages/packages-lock.json',
  'ProjectSettings/',
  'Temp/',
  'UserSettings/',
  '.gitignore',
  'Assembly-CSharp.csproj',
  'PieceExploration.sln'
]

function ScopedTree({ scope }: { scope: string }): React.JSX.Element {
  const [model, setModel] = useState<FileTree | null>(null)
  useEffect(() => {
    const created = createFileExplorerTree({
      onSelectionChange: () => {},
      canRename: () => false,
      onRename: () => {},
      canDrag: () => false,
      onDropComplete: () => {}
    })
    const prefix = scope === FILE_EXPLORER_FULL_ROOT ? '' : scope
    // Nested projects (Game/Assets) list the same project under their folder.
    const projectDir = prefix.includes('/') ? `${prefix.split('/')[0]}/` : ''
    resetFileTreePathsWithExpansion(
      created,
      scopeTreeInputPaths(
        prefix,
        PROJECT_LISTING.map((path) => `${projectDir}${path}`)
      ),
      new Set(prefix ? ['Scripts'] : [])
    )
    setModel(created)
    return () => created.cleanUp()
  }, [scope])
  return (
    <div className="flex h-[260px] min-h-0 flex-col">
      {model && (
        <FileTreeView
          model={model}
          className="min-h-0 flex-1 py-1"
          style={FILE_EXPLORER_TREE_HOST_STYLE}
        />
      )}
    </div>
  )
}

function renderExplorer(projectRoots: string[], scope: string): React.JSX.Element {
  const options = getUnityExplorerScopeOptions(projectRoots, WORKSPACE) ?? []
  return (
    <div className="flex flex-col bg-sidebar">
      <FileExplorerToolbar
        repoName="PieceExploration"
        worktreePath={WORKSPACE}
        refresh={{ isRefreshing: false, showRefreshSpinner: false, handleRefresh: () => {} }}
        canRefresh
        canCollapseAll
        onCollapseAll={() => {}}
        showGitIgnoredFilesToggle
        showGitIgnoredFiles
        onToggleGitIgnoredFiles={() => {}}
        showDotfiles
        onToggleDotfiles={() => {}}
        scopeSelect={
          <FileExplorerUnityScopeSelect scope={{ options, choice: scope, selectScope: () => {} }} />
        }
      />
      <ScopedTree scope={scope} />
    </div>
  )
}

const openScopeMenu = (frame: HTMLElement): void => {
  frame
    .querySelector<HTMLButtonElement>('button[aria-label="Explorer scope"]')
    ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
}

// Default Unity scope: the tree is rooted at Assets, like Unity's Project window.
export const assetsScope = defineFixture({
  width: 300,
  render: () => renderExplorer([WORKSPACE], 'Assets')
})

export const wholeFolder = defineFixture({
  width: 300,
  render: () => renderExplorer([WORKSPACE], FILE_EXPLORER_FULL_ROOT)
})

export const scopeMenu = defineFixture({
  width: 300,
  render: () => renderExplorer([WORKSPACE], 'Assets'),
  interact: openScopeMenu
})

// Monorepos list each project's roots by project name.
export const multiProjectMenu = defineFixture({
  width: 300,
  render: () => renderExplorer([`${WORKSPACE}/Game`, `${WORKSPACE}/Tools`], 'Game/Assets'),
  interact: openScopeMenu
})
