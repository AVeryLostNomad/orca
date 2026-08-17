import { memo, useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../../store'
import type { DataStudioTab } from '../../../../shared/data-studio-types'
import type { Tab, TabGroup } from '../../../../shared/tab-types'
import DataStudioPane from './DataStudioPane'
import { tabGroupBodyAnchorName } from '../tab-group/tab-group-body-anchor'

// Why: mirrors CodeServerPaneOverlayLayer — the Data Studio `<webview>`
// destroys its guest on reparent, and the pane ties acquire/release + webview
// create/destroy to its own mount/unmount. Rendering once per tab at the
// worktree level means tab switches / split moves only update the overlay's
// CSS `position-anchor`, so the per-repo server stays up and the workbench
// never reloads.

type DataStudioOverlayAssignment = {
  groupId: string
  isActiveInGroup: boolean
}

const EMPTY_DATA_STUDIO_TABS: readonly DataStudioTab[] = []
const EMPTY_UNIFIED_TABS: readonly Tab[] = []
const EMPTY_GROUPS: readonly TabGroup[] = []

type DataStudioOverlaySlotProps = {
  dataStudioTab: DataStudioTab
  // Why: `undefined` means no owning group (an orphan — present in
  // `dataStudioTabs` but not referenced by any group's unified-tab list); the
  // slot stays hidden until reassigned or closed.
  groupId: string | undefined
  isActive: boolean
  // Why: the overlay is a SIBLING of TabGroupSplitLayout, so pane events don't
  // reach TabGroupPanel's focus sync; re-implement it targeting the owning group.
  onFocusOwningGroup: ((groupId: string) => void) | undefined
}

// Why: memoized so the pane subtree only re-renders when its own assignment or
// active state changes — unrelated worktree mutations must not cascade in.
const DataStudioOverlaySlot = memo(function DataStudioOverlaySlot({
  dataStudioTab,
  groupId,
  isActive,
  onFocusOwningGroup
}: DataStudioOverlaySlotProps): React.JSX.Element {
  const anchorName = groupId !== undefined ? tabGroupBodyAnchorName(groupId) : undefined
  // Why: CSS anchor positioning pins the overlay to the owning TabGroupPanel's
  // body; moving the tab between groups only changes `positionAnchor`.
  const style: React.CSSProperties = useMemo(
    () =>
      anchorName
        ? {
            position: 'absolute',
            positionAnchor: anchorName,
            top: `anchor(${anchorName} top)`,
            left: `anchor(${anchorName} left)`,
            width: `anchor-size(${anchorName} width)`,
            height: `anchor-size(${anchorName} height)`,
            display: isActive ? 'flex' : 'none',
            pointerEvents: isActive ? 'auto' : 'none',
            opacity: isActive ? 1 : 0
          }
        : {
            position: 'absolute',
            top: 0,
            left: 0,
            width: 0,
            height: 0,
            display: 'none',
            pointerEvents: 'none'
          },
    [anchorName, isActive]
  )
  const handleFocus = useCallback(() => {
    if (groupId !== undefined && onFocusOwningGroup) {
      onFocusOwningGroup(groupId)
    }
  }, [groupId, onFocusOwningGroup])

  return (
    <div
      style={style}
      className="relative flex min-h-0 flex-1 flex-col"
      data-data-studio-overlay-tab-id={dataStudioTab.id}
      onPointerDown={handleFocus}
      onFocusCapture={handleFocus}
    >
      {/* Why: mount unconditionally for every open datastudio tab. Unmounting
          would call the pane's release() and destroy the workbench guest; a
          hidden worktree already display:none's the whole surface, so the
          mounted pane simply isn't painted and the guest survives. */}
      <DataStudioPane dataStudioTabId={dataStudioTab.id} worktreeId={dataStudioTab.worktreeId} />
    </div>
  )
})

// Why: memoize so parent re-renders with props this component doesn't consume
// don't rerun the overlay's zustand selector or the assignments mapping.
const DataStudioPaneOverlayLayer = memo(function DataStudioPaneOverlayLayer({
  worktreeId,
  isWorktreeActive
}: {
  worktreeId: string
  isWorktreeActive: boolean
}): React.JSX.Element {
  const { dataStudioTabs, unifiedTabs, groups } = useAppStore(
    useShallow((state) => ({
      dataStudioTabs: state.dataStudioTabsByWorktree[worktreeId] ?? EMPTY_DATA_STUDIO_TABS,
      unifiedTabs: state.unifiedTabsByWorktree[worktreeId] ?? EMPTY_UNIFIED_TABS,
      groups: state.groupsByWorktree[worktreeId] ?? EMPTY_GROUPS
    }))
  )
  const focusGroup = useAppStore((state) => state.focusGroup)

  // Why: stable callback identity so the slot's memo isn't broken by a fresh
  // function reference every render.
  const focusOwningGroup = useCallback(
    (groupId: string) => focusGroup(worktreeId, groupId),
    [focusGroup, worktreeId]
  )

  // Why: derive the lookup OUTSIDE the zustand selector so shallow equality
  // holds across unrelated store mutations.
  const groupActiveTabById = useMemo(() => {
    const lookup: Record<string, string | null | undefined> = {}
    for (const group of groups) {
      lookup[group.id] = group.activeTabId
    }
    return lookup
  }, [groups])

  const assignments = useMemo(() => {
    const entries = new Map<string, DataStudioOverlayAssignment>()
    for (const tab of unifiedTabs) {
      if (tab.contentType !== 'datastudio') {
        continue
      }
      entries.set(tab.entityId, {
        groupId: tab.groupId,
        isActiveInGroup: groupActiveTabById[tab.groupId] === tab.id
      })
    }
    return entries
  }, [groupActiveTabById, unifiedTabs])

  return (
    <>
      {dataStudioTabs.map((dataStudioTab) => {
        const assignment = assignments.get(dataStudioTab.id)
        const isActive = Boolean(isWorktreeActive && assignment && assignment.isActiveInGroup)
        return (
          <DataStudioOverlaySlot
            key={dataStudioTab.id}
            dataStudioTab={dataStudioTab}
            groupId={assignment?.groupId}
            isActive={isActive}
            onFocusOwningGroup={focusOwningGroup}
          />
        )
      })}
    </>
  )
})

export default DataStudioPaneOverlayLayer
