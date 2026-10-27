import { useEffect, useMemo } from 'react'
import {
  getWorktreePaletteSelectionItemIds,
  CREATE_WORKTREE_ITEM_ID
} from '@/lib/worktree-palette-create-action'
import { translate } from '@/i18n/i18n'
import {
  appendPaletteListEntries,
  type FilePaletteItem,
  type PaletteItem,
  type PaletteListEntry
} from './worktree-jump-palette-model'
import { appendMultiPrimaryPaletteEntries } from './worktree-jump-palette-multi-primary-entries'
import { buildPaletteListEntryRenderKeys } from '@/components/cmd-j/palette-list-entry-render-keys'
import { BROWSER_NAVIGATION_ACTION_ID } from '@/components/cmd-j/browser-navigation-action'
import type { WorktreeJumpPaletteSections } from './use-worktree-jump-palette-sections'
import type { WorktreeJumpPaletteWorktrees } from './use-worktree-jump-palette-worktrees'
import type { WorktreeJumpPaletteLocalState } from './use-worktree-jump-palette-local-state'
import type { CommandBarMode } from '@/components/cmd-j/command-bar-mode'
import type { WorktreeJumpPaletteTaskSearch } from './use-worktree-jump-palette-task-search'

type WorktreeJumpPaletteListEntriesInput = WorktreeJumpPaletteSections &
  Pick<WorktreeJumpPaletteTaskSearch, 'taskItems'> &
  Pick<WorktreeJumpPaletteWorktrees, 'hasQuery'> &
  Pick<WorktreeJumpPaletteLocalState, 'autoSelectedItemIdRef' | 'query' | 'taskSourceUrl'> &
  Pick<WorktreeJumpPaletteSections, 'middleLeadsSections' | 'handleExpandSection'> & {
    fileItems: readonly FilePaletteItem[]
    paletteMode: CommandBarMode
    showQuickAi: boolean
  }

export function useWorktreeJumpPaletteListEntries({
  hasQuery,
  openTabsLeadSections,
  paletteSections,
  showCreateAction,
  autoSelectedItemIdRef,
  taskSourceUrl,
  query,
  handleExpandSection,
  middleLeadsSections,
  fileItems,
  paletteMode,
  showQuickAi,
  taskItems
}: WorktreeJumpPaletteListEntriesInput) {
  const listEntries = useMemo<PaletteListEntry[]>(() => {
    const entries: PaletteListEntry[] = []
    if (showQuickAi) {
      entries.push({ id: '__quick_ai__', type: 'quick-ai', query })
    }
    if (paletteMode === 'files') {
      appendPaletteListEntries(entries, fileItems)
      return entries
    }
    const {
      visibleWorktreeItems,
      visibleProjectTargetItems,
      visibleMiddleItems: middleItems,
      visibleOpenTabItems,
      worktreeOverflowCount,
      projectTargetOverflowCount,
      middleOverflowCount,
      openTabOverflowCount,
      multiPrimaryFirstScreen,
      multiPrimaryLayout
    } = paletteSections
    // Exact entity matches keep priority; issue/PR URLs keep their jump and create rows first.
    const browserNavigationItem =
      taskSourceUrl || !paletteSections.hasExactEntityDestination
        ? middleItems.find(
            (item) =>
              item.type === 'quick-action' && item.result.id === BROWSER_NAVIGATION_ACTION_ID
          )
        : undefined
    const visibleMiddleItems = middleItems.filter((item) => item !== browserNavigationItem)
    const pushTasks = (): void => {
      if (taskItems.length) {
        entries.push({
          id: '__header_tasks__',
          type: 'section-header',
          label: translate('worktreeJumpPalette.tasksHeader', 'Tasks')
        })
        appendPaletteListEntries(entries, taskItems)
      }
    }
    const pushOverflowHint = (id: string, overflowCount: number, onSeeMore?: () => void): void => {
      if (overflowCount > 0) {
        entries.push({
          id,
          type: 'hint',
          label: translate('worktreeJumpPalette.renderCapOverflow', '{{value0}} more', {
            value0: overflowCount
          }),
          onSeeMore
        })
      }
    }
    const showWorktreeHeader = visibleWorktreeItems.length > 0
    const showOpenTabsHeader = visibleOpenTabItems.length > 0
    const showProjectTargetHeader = visibleProjectTargetItems.length > 0
    const showMiddleHeader = visibleMiddleItems.length > 0
    const pushOpenTabsHeader = (idSuffix = ''): void => {
      if (!showOpenTabsHeader) {
        return
      }
      entries.push({
        id: `__header_open_tabs__${idSuffix}`,
        type: 'section-header',
        label: hasQuery
          ? translate('auto.components.WorktreeJumpPalette.50a1d11d5b', 'Open Tabs')
          : translate(
              'auto.components.WorktreeJumpPalette.recentChatsTerminalsHeader',
              'Recent Chats & Terminals'
            )
      })
    }
    const pushWorktreesHeader = (idSuffix = ''): void => {
      if (!showWorktreeHeader) {
        return
      }
      entries.push({
        id: `__header_worktrees__${idSuffix}`,
        type: 'section-header',
        label: hasQuery
          ? translate('auto.components.WorktreeJumpPalette.worktreesHeader', 'Workspaces')
          : translate(
              'auto.components.WorktreeJumpPalette.recentWorktreesHeader',
              'Recent Workspaces'
            )
      })
    }
    const pushWorktreeSection = (): void => {
      if (visibleWorktreeItems.length === 0) {
        return
      }
      pushWorktreesHeader()
      appendPaletteListEntries(entries, visibleWorktreeItems)
      pushOverflowHint('__hint_worktree_overflow__', worktreeOverflowCount, () =>
        handleExpandSection('worktrees')
      )
    }
    const pushOpenTabSection = (): void => {
      if (visibleOpenTabItems.length === 0) {
        return
      }
      pushOpenTabsHeader()
      appendPaletteListEntries(entries, visibleOpenTabItems)
      pushOverflowHint('__hint_open_tab_overflow__', openTabOverflowCount, () =>
        handleExpandSection('open-tabs')
      )
    }
    const pushProjectAndMiddleSections = (): void => {
      if (visibleProjectTargetItems.length > 0) {
        if (showProjectTargetHeader) {
          entries.push({
            id: '__header_projects_groups__',
            type: 'section-header',
            label: translate(
              'auto.components.WorktreeJumpPalette.projectsGroupsHeader',
              'Projects & Groups'
            )
          })
        }
        appendPaletteListEntries(entries, visibleProjectTargetItems)
        pushOverflowHint('__hint_project_overflow__', projectTargetOverflowCount, () =>
          handleExpandSection('projects')
        )
      }
      if (visibleMiddleItems.length > 0) {
        if (showMiddleHeader) {
          entries.push({
            id: '__header_actions_settings__',
            type: 'section-header',
            label: translate('auto.components.WorktreeJumpPalette.088d66d980', 'Actions & Settings')
          })
        }
        appendPaletteListEntries(entries, visibleMiddleItems)
        pushOverflowHint('__hint_middle_overflow__', middleOverflowCount, () =>
          handleExpandSection('middle')
        )
      }
      if (fileItems.length > 0) {
        entries.push({
          id: '__header_files__',
          type: 'section-header',
          label: translate('auto.components.WorktreeJumpPalette.filesHeader', 'Files')
        })
        appendPaletteListEntries(entries, fileItems)
      }
    }
    // Issue/PR URLs put linked worktrees first for Enter-to-jump while keeping create underneath.
    if (taskSourceUrl) {
      if (visibleWorktreeItems.length > 0) {
        pushWorktreeSection()
      }
      if (showCreateAction) {
        entries.push({ id: CREATE_WORKTREE_ITEM_ID, type: 'create-worktree' })
      }
      if (browserNavigationItem) {
        entries.push(browserNavigationItem)
      }
      return entries
    }
    if (!hasQuery) {
      pushOpenTabSection()
      pushWorktreeSection()
      return entries
    }
    if (browserNavigationItem) {
      entries.push(browserNavigationItem)
    }
    if (multiPrimaryFirstScreen && multiPrimaryLayout) {
      appendMultiPrimaryPaletteEntries({
        entries,
        layout: multiPrimaryLayout,
        openTabsLeadSections,
        pushOpenTabsHeader,
        pushWorktreesHeader,
        pushOverflowHint,
        handleExpandSection
      })
      pushProjectAndMiddleSections()
      pushTasks()
      if (showCreateAction) {
        entries.push({ id: CREATE_WORKTREE_ITEM_ID, type: 'create-worktree' })
      }
      return entries
    }
    if (middleLeadsSections) {
      pushProjectAndMiddleSections()
    }
    if (openTabsLeadSections) {
      pushOpenTabSection()
    }
    pushWorktreeSection()
    if (!middleLeadsSections) {
      pushProjectAndMiddleSections()
    }
    if (!openTabsLeadSections) {
      pushOpenTabSection()
    }
    pushTasks()
    if (showCreateAction) {
      entries.push({ id: CREATE_WORKTREE_ITEM_ID, type: 'create-worktree' })
    }
    return entries
  }, [
    fileItems,
    handleExpandSection,
    hasQuery,
    middleLeadsSections,
    openTabsLeadSections,
    paletteMode,
    paletteSections,
    query,
    showCreateAction,
    showQuickAi,
    taskSourceUrl,
    taskItems
  ])
  const selectableItems = useMemo<PaletteItem[]>(
    () =>
      listEntries.filter(
        (entry): entry is PaletteItem =>
          entry.type !== 'section-header' &&
          entry.type !== 'hint' &&
          entry.type !== 'create-worktree' &&
          entry.type !== 'file' &&
          entry.type !== 'quick-ai'
      ),
    [listEntries]
  )
  const listEntryRenderKeys = useMemo(
    () => buildPaletteListEntryRenderKeys(listEntries.map((entry) => entry.id)),
    [listEntries]
  )
  const selectionItemIds = useMemo(
    () => getWorktreePaletteSelectionItemIds(listEntries, listEntryRenderKeys),
    [listEntries, listEntryRenderKeys]
  )
  useEffect(() => {
    autoSelectedItemIdRef.current = selectionItemIds[0] ?? null
  }, [autoSelectedItemIdRef, selectionItemIds])
  return { listEntries, listEntryRenderKeys, selectableItems, selectionItemIds }
}

export type WorktreeJumpPaletteListEntries = ReturnType<typeof useWorktreeJumpPaletteListEntries>
