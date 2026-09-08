// Ordered slices of one registry: `definitions.ts` concatenates core-1..4 in order and that order
// is the palette order, so the boundaries follow line count, not theme — do not regroup thematically.
import type { KeybindingDefinition } from './types'
import { platformBindings } from './definitions-support'

const GLOBAL_KEYBINDING = {
  group: 'Global',
  scope: 'global'
} satisfies Pick<KeybindingDefinition, 'group' | 'scope'>

export const KEYBINDING_DEFINITION_CORE_1: readonly KeybindingDefinition[] = [
  {
    id: 'worktree.quickOpen',
    title: 'Go to File',
    ...GLOBAL_KEYBINDING,
    searchKeywords: ['shortcut', 'global', 'file', 'quick open'],
    defaultBindings: platformBindings(['Mod+P'])
  },
  {
    id: 'app.settings',
    allowInVsCode: true,
    title: 'Open Settings',
    ...GLOBAL_KEYBINDING,
    searchKeywords: ['shortcut', 'settings', 'preferences'],
    defaultBindings: platformBindings(['Mod+Comma']),
    conflictGroup: 'menu'
  },
  {
    id: 'app.forceReload',
    allowInVsCode: true,
    title: 'Force Reload',
    ...GLOBAL_KEYBINDING,
    searchKeywords: ['shortcut', 'reload', 'refresh', 'force'],
    defaultBindings: platformBindings(['Mod+Shift+R']),
    conflictGroup: 'menu'
  },
  {
    id: 'worktree.palette',
    allowInVsCode: true,
    title: 'Open Command Bar',
    ...GLOBAL_KEYBINDING,
    searchKeywords: [
      'shortcut',
      'global',
      'worktree',
      'switch',
      'jump',
      'command bar',
      'command palette',
      'actions'
    ],
    defaultBindings: {
      darwin: ['Mod+J', 'Mod+Shift+A'],
      linux: ['Mod+Shift+J', 'Mod+Shift+A'],
      win32: ['Mod+Shift+J', 'Mod+Shift+A']
    }
  },
  {
    id: 'worktree.navigateUp',
    title: 'Previous worktree',
    ...GLOBAL_KEYBINDING,
    searchKeywords: ['shortcut', 'global', 'worktree', 'previous', 'up'],
    defaultBindings: platformBindings(['Mod+Shift+ArrowUp'])
  },
  {
    id: 'worktree.navigateDown',
    title: 'Next worktree',
    ...GLOBAL_KEYBINDING,
    searchKeywords: ['shortcut', 'global', 'worktree', 'next', 'down'],
    defaultBindings: platformBindings(['Mod+Shift+ArrowDown'])
  },
  {
    id: 'workspace.create',
    title: 'Create worktree',
    ...GLOBAL_KEYBINDING,
    searchKeywords: ['shortcut', 'global', 'worktree', 'create', 'new workspace'],
    defaultBindings: platformBindings(['Mod+N', 'Mod+Shift+N'])
  },
  {
    id: 'workspace.rename',
    title: 'Rename worktree',
    ...GLOBAL_KEYBINDING,
    conflictGroup: 'workspace-shell',
    searchKeywords: ['shortcut', 'global', 'worktree', 'rename', 'workspace', 'title'],
    // Why: macOS only — Windows/Linux Ctrl+Alt+R has no safe default (Ctrl+R reverse-search, Ctrl+Shift+R reload are taken).
    defaultBindings: {
      darwin: ['Mod+Alt+R'],
      linux: [],
      win32: []
    }
  },
  {
    id: 'workspace.delete',
    allowInVsCode: true,
    title: 'Delete Workspace',
    ...GLOBAL_KEYBINDING,
    searchKeywords: [
      'shortcut',
      'global',
      'workspace',
      'current workspace',
      'worktree',
      'delete',
      'remove',
      'trash'
    ],
    // Why: Backspace avoids the terminal pane's D-based split shortcuts on every platform.
    defaultBindings: platformBindings(['Mod+Shift+Backspace']),
    allowInTerminal: true
  },
  {
    id: 'workspace.openBoard',
    allowInVsCode: true,
    title: 'Toggle Workspace Board',
    ...GLOBAL_KEYBINDING,
    searchKeywords: [
      'shortcut',
      'global',
      'workspace',
      'board',
      'kanban',
      'worktree',
      'toggle',
      'open',
      'close'
    ],
    // Why: configurable but unbound by default, to not take a global chord from terminal/browser/editor users.
    defaultBindings: platformBindings([]),
    allowInTerminal: true
  },
  {
    id: 'dashboard.toggle',
    title: 'Toggle Agent Dashboard',
    ...GLOBAL_KEYBINDING,
    searchKeywords: [
      'shortcut',
      'global',
      'agent',
      'agents',
      'dashboard',
      'kanban',
      'board',
      'toggle',
      'open',
      'close'
    ],
    // Why: configurable but unbound by default, matching workspace.openBoard — an
    // experimental surface must not claim a global chord from terminal users.
    defaultBindings: platformBindings([]),
    allowInTerminal: true
  },
  {
    id: 'workspace.selectByIndex',
    allowInVsCode: true,
    title: 'Select Workspace 1–9',
    ...GLOBAL_KEYBINDING,
    searchKeywords: [
      'shortcut',
      'global',
      'workspace',
      'worktree',
      'select',
      'switch',
      'number',
      'digit',
      '1-9',
      'index'
    ],
    // Why: one remappable row covers the whole 1-9 range (stored chord is a representative; any of 1-9 fires it).
    defaultBindings: platformBindings(['Mod+1'])
  },
  {
    id: 'voice.dictation',
    allowInVsCode: true,
    title: 'Dictation',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'dictation', 'voice', 'speech', 'microphone'],
    defaultBindings: platformBindings(['Mod+E'])
  },
  {
    id: 'view.tasks',
    allowInVsCode: true,
    title: 'Open Tasks',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'tasks', 'github issues', 'linear'],
    defaultBindings: platformBindings([])
  },
  {
    id: 'sidebar.left.toggle',
    allowInVsCode: true,
    title: 'Toggle Sidebar',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'sidebar', 'left'],
    defaultBindings: platformBindings(['Mod+B'])
  },
  {
    id: 'sidebar.right.toggle',
    allowInVsCode: true,
    title: 'Toggle Right Sidebar',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'sidebar', 'right'],
    defaultBindings: platformBindings(['Mod+L'])
  },
  {
    id: 'sidebar.explorer.toggle',
    title: 'Show Explorer',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'sidebar', 'explorer', 'files'],
    defaultBindings: platformBindings(['Mod+Shift+E'])
  },
  {
    id: 'sidebar.search.toggle',
    title: 'Show Search',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'sidebar', 'search'],
    defaultBindings: platformBindings(['Mod+Shift+F'])
  },
  {
    id: 'sidebar.sourceControl.toggle',
    title: 'Show Source Control',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'sidebar', 'source control', 'git'],
    defaultBindings: platformBindings(['Mod+Shift+G'])
  },
  {
    id: 'sidebar.checks.toggle',
    title: 'Show Checks',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'sidebar', 'checks', 'ci'],
    defaultBindings: platformBindings([])
  },
  {
    id: 'sidebar.ports.toggle',
    title: 'Show Ports',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'sidebar', 'ports'],
    defaultBindings: {
      darwin: ['Mod+Shift+I'],
      linux: [],
      win32: []
    }
  },
  {
    id: 'sidebar.sleepingWorkspaces.toggle',
    title: 'Toggle Sleeping Workspaces',
    group: 'Global',
    scope: 'global',
    searchKeywords: [
      'shortcut',
      'sidebar',
      'sleeping',
      'asleep',
      'workspaces',
      'worktree',
      'filter',
      'show',
      'hide'
    ],
    // Why: ship unbound (issue #5209 asks users to assign it), avoiding a claimed cross-platform chord.
    defaultBindings: platformBindings([])
  },
  {
    id: 'sidebar.focusWorktreeList',
    title: 'Focus worktree list',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'sidebar', 'worktree', 'focus'],
    // Why: keep zoom.reset on the browser-standard Mod+0; this chord was unreachable while it shared that default (#8584).
    defaultBindings: platformBindings(['Mod+Shift+0'])
  },
  {
    id: 'floatingTerminal.toggle',
    allowInVsCode: true,
    title: 'Toggle Floating Terminal',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'floating terminal', 'terminal'],
    defaultBindings: platformBindings(['Mod+Alt+A']),
    allowInTerminal: true
  },
  {
    id: 'floatingWorkspace.maximize',
    title: 'Maximize Floating Workspace Panel',
    group: 'Global',
    scope: 'global',
    searchKeywords: [
      'shortcut',
      'floating',
      'workspace',
      'panel',
      'floating workspace',
      'workspace panel',
      'maximize',
      'expand'
    ],
    // Why: pairs with floatingTerminal.toggle (Cmd+Opt+A) so maximize stays one-handed; macOS-only, Linux/Windows unbound.
    defaultBindings: {
      darwin: ['Mod+Alt+Shift+A'],
      linux: [],
      win32: []
    },
    allowInTerminal: true
  }
]
