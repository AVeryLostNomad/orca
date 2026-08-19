import {
  ArrowLeft,
  ArrowRight,
  FolderKanban,
  GitBranch,
  ListChecks,
  Maximize2,
  Moon,
  Network,
  PanelLeft,
  PanelRight,
  Pencil,
  Search,
  SquareCheckBig,
  FolderTree
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { PluginCommandAliasActionId } from '../../../../shared/plugins/plugin-command-actions'
import { translate } from '@/i18n/i18n'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'

export type AliasItemSpec = {
  actionId: PluginCommandAliasActionId
  title: string
  description: string
  icon: LucideIcon
  verbKeywords: string[]
  /** Alias handlers guard themselves; only workspace-scoped ones pre-check here. */
  workspaceScoped?: boolean
}

// Explicit allowlist bridged over dispatchAppCommand — NOT auto-generated from
// KEYBINDING_DEFINITIONS: most definitions are context-local chords
// (terminal.paste, editor.save) with no app-wide handler to dispatch to.
export const getAliasItemSpecs = createLocalizedCatalog((): AliasItemSpec[] => [
  {
    actionId: 'sidebar.left.toggle',
    title: translate('auto.components.cmd.j.commands.toggleLeftSidebar', 'Toggle Left Sidebar'),
    description: translate(
      'auto.components.cmd.j.commands.toggleLeftSidebarDesc',
      'Show or hide the workspace sidebar.'
    ),
    icon: PanelLeft,
    verbKeywords: [
      translate('auto.components.cmd.j.commands.kw.toggleSidebar', 'toggle sidebar'),
      translate('auto.components.cmd.j.commands.kw.hideSidebar', 'hide sidebar'),
      translate('auto.components.cmd.j.commands.kw.showSidebar', 'show sidebar')
    ]
  },
  {
    actionId: 'sidebar.right.toggle',
    title: translate('auto.components.cmd.j.commands.toggleRightSidebar', 'Toggle Right Sidebar'),
    description: translate(
      'auto.components.cmd.j.commands.toggleRightSidebarDesc',
      'Show or hide the explorer/source-control sidebar.'
    ),
    icon: PanelRight,
    verbKeywords: [
      translate('auto.components.cmd.j.commands.kw.toggleRightSidebar', 'toggle right sidebar')
    ]
  },
  {
    actionId: 'sidebar.explorer.toggle',
    title: translate('auto.components.cmd.j.commands.showExplorer', 'Show Explorer'),
    description: translate(
      'auto.components.cmd.j.commands.showExplorerDesc',
      'Open the file explorer panel.'
    ),
    icon: FolderTree,
    verbKeywords: [
      translate('auto.components.cmd.j.commands.kw.explorer', 'explorer'),
      translate('auto.components.cmd.j.commands.kw.files', 'files'),
      translate('auto.components.cmd.j.commands.kw.fileTree', 'file tree')
    ],
    workspaceScoped: true
  },
  {
    actionId: 'sidebar.search.toggle',
    title: translate('auto.components.cmd.j.commands.showSearch', 'Show Search'),
    description: translate(
      'auto.components.cmd.j.commands.showSearchDesc',
      'Open workspace-wide text search.'
    ),
    icon: Search,
    verbKeywords: [
      translate('auto.components.cmd.j.commands.kw.search', 'search'),
      translate('auto.components.cmd.j.commands.kw.findInFiles', 'find in files'),
      translate('auto.components.cmd.j.commands.kw.grep', 'grep')
    ],
    workspaceScoped: true
  },
  {
    actionId: 'sidebar.sourceControl.toggle',
    title: translate('auto.components.cmd.j.commands.showSourceControl', 'Show Source Control'),
    description: translate(
      'auto.components.cmd.j.commands.showSourceControlDesc',
      'Open the source control panel.'
    ),
    icon: GitBranch,
    verbKeywords: [
      translate('auto.components.cmd.j.commands.kw.sourceControl', 'source control'),
      translate('auto.components.cmd.j.commands.kw.git', 'git'),
      translate('auto.components.cmd.j.commands.kw.changes', 'changes'),
      translate('auto.components.cmd.j.commands.kw.diff', 'diff')
    ],
    workspaceScoped: true
  },
  {
    actionId: 'sidebar.checks.toggle',
    title: translate('auto.components.cmd.j.commands.showChecks', 'Show Checks'),
    description: translate(
      'auto.components.cmd.j.commands.showChecksDesc',
      'Open the checks panel.'
    ),
    icon: SquareCheckBig,
    verbKeywords: [
      translate('auto.components.cmd.j.commands.kw.checks', 'checks'),
      translate('auto.components.cmd.j.commands.kw.ci', 'ci')
    ],
    workspaceScoped: true
  },
  {
    actionId: 'sidebar.ports.toggle',
    title: translate('auto.components.cmd.j.commands.showPorts', 'Show Ports'),
    description: translate(
      'auto.components.cmd.j.commands.showPortsDesc',
      'Open the forwarded ports panel.'
    ),
    icon: Network,
    verbKeywords: [
      translate('auto.components.cmd.j.commands.kw.ports', 'ports'),
      translate('auto.components.cmd.j.commands.kw.devServer', 'dev server'),
      translate('auto.components.cmd.j.commands.kw.localhost', 'localhost')
    ],
    workspaceScoped: true
  },
  {
    actionId: 'sidebar.sleepingWorkspaces.toggle',
    title: translate(
      'auto.components.cmd.j.commands.toggleSleepingWorkspaces',
      'Toggle Sleeping Workspaces'
    ),
    description: translate(
      'auto.components.cmd.j.commands.toggleSleepingWorkspacesDesc',
      'Show or hide sleeping workspaces in the sidebar.'
    ),
    icon: Moon,
    verbKeywords: [translate('auto.components.cmd.j.commands.kw.sleeping', 'sleeping workspaces')]
  },
  {
    actionId: 'workspace.rename',
    title: translate('auto.components.cmd.j.commands.renameWorkspace', 'Rename Workspace'),
    description: translate(
      'auto.components.cmd.j.commands.renameWorkspaceDesc',
      'Rename the current workspace.'
    ),
    icon: Pencil,
    verbKeywords: [
      translate('auto.components.cmd.j.commands.kw.renameWorkspace', 'rename workspace'),
      translate('auto.components.cmd.j.commands.kw.renameWorktree', 'rename worktree')
    ],
    workspaceScoped: true
  },
  {
    actionId: 'tab.rename',
    title: translate('auto.components.cmd.j.commands.renameTab', 'Rename Tab'),
    description: translate(
      'auto.components.cmd.j.commands.renameTabDesc',
      'Rename the active tab.'
    ),
    icon: Pencil,
    verbKeywords: [translate('auto.components.cmd.j.commands.kw.renameTab', 'rename tab')],
    workspaceScoped: true
  },
  {
    actionId: 'workspace.openBoard',
    title: translate('auto.components.cmd.j.commands.openBoard', 'Open Workspace Board'),
    description: translate(
      'auto.components.cmd.j.commands.openBoardDesc',
      'Open the workspace kanban board.'
    ),
    icon: FolderKanban,
    verbKeywords: [
      translate('auto.components.cmd.j.commands.kw.board', 'board'),
      translate('auto.components.cmd.j.commands.kw.kanban', 'kanban')
    ]
  },
  {
    actionId: 'view.tasks',
    title: translate('auto.components.cmd.j.commands.openTasks', 'Open Tasks'),
    description: translate('auto.components.cmd.j.commands.openTasksDesc', 'Open the tasks page.'),
    icon: ListChecks,
    verbKeywords: [
      translate('auto.components.cmd.j.commands.kw.tasks', 'tasks'),
      translate('auto.components.cmd.j.commands.kw.issues', 'issues')
    ]
  },
  {
    actionId: 'worktree.history.back',
    title: translate('auto.components.cmd.j.commands.historyBack', 'Navigate Back'),
    description: translate(
      'auto.components.cmd.j.commands.historyBackDesc',
      'Go back in workspace history.'
    ),
    icon: ArrowLeft,
    verbKeywords: [translate('auto.components.cmd.j.commands.kw.back', 'back')]
  },
  {
    actionId: 'worktree.history.forward',
    title: translate('auto.components.cmd.j.commands.historyForward', 'Navigate Forward'),
    description: translate(
      'auto.components.cmd.j.commands.historyForwardDesc',
      'Go forward in workspace history.'
    ),
    icon: ArrowRight,
    verbKeywords: [translate('auto.components.cmd.j.commands.kw.forward', 'forward')]
  },
  {
    actionId: 'floatingWorkspace.maximize',
    title: translate(
      'auto.components.cmd.j.commands.maximizeFloating',
      'Maximize Floating Workspace'
    ),
    description: translate(
      'auto.components.cmd.j.commands.maximizeFloatingDesc',
      'Expand the floating workspace panel.'
    ),
    icon: Maximize2,
    verbKeywords: [translate('auto.components.cmd.j.commands.kw.floating', 'floating workspace')]
  }
])
