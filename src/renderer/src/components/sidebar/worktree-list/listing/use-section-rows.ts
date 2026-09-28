import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import type { FolderWorkspace } from '../../../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { ProjectOrderBy } from '../../../../../../shared/ui-chrome-types'
import type { Repo } from '../../../../../../shared/repo-types'
import type { WorkspaceStatusDefinition, Worktree } from '../../../../../../shared/worktree/types'
import type { WorktreeLineage } from '../../../../../../shared/worktree/lineage-types'
import type { ExecutionHostId } from '../../../../../../shared/execution-host'
import { folderWorkspaceKey } from '../../../../../../shared/workspace-scope'
import { buildRows } from '../grouping/build-rows'
import type { ProjectGroupingModel } from '../grouping/project-grouping'
import type { PinnedWorktreeDisplayPolicy, Row, WorktreeGroupBy } from '../grouping/row-types'
import { getLogicalRepoOrderRankById } from '../../project-header-drop'
import { getEmptyProjectPlaceholderRepoIds } from '../../empty-project-placeholder-repos'
import { selectPendingWorktreeCreationKeys } from './pending-worktree-creation-keys'

type SectionRowsArgs = {
  groupBy: WorktreeGroupBy
  projectOrderBy: ProjectOrderBy
  pinnedDisplayPolicy: PinnedWorktreeDisplayPolicy
  worktrees: Worktree[]
  repos: readonly Repo[]
  repoMap: Map<string, Repo>
  worktreeMap: Map<string, Worktree>
  worktreeLineageById: Record<string, WorktreeLineage>
  prCache: AppState['prCache'] | null
  settings: AppState['settings']
  workspaceStatuses: readonly WorkspaceStatusDefinition[]
  effectiveCollapsedGroups: Set<string>
  projectGrouping: ProjectGroupingModel
  visibleReposForRows: readonly Repo[]
  visibleProjectGroupsForRows: readonly ProjectGroup[]
  visibleFolderWorkspacesForRows: readonly FolderWorkspace[]
  importedWorktreesByRepo: Parameters<typeof buildRows>[14]
  newExternalWorktreesInboxByRepo: Parameters<typeof buildRows>[15]
  filterRepoIds: readonly string[]
  /** Set on paged host sidebars: rows that name no host of their own must still stay on this page. */
  hostPageId?: ExecutionHostId
}

function collectRenderedSidebarRowKeys(sectionRows: readonly Row[]) {
  const keys = new Set<string>()
  for (const row of sectionRows) {
    if (row.type === 'header') {
      keys.add(row.key)
    } else if (row.type === 'item') {
      keys.add(row.rowKey)
    } else if (row.type === 'folder-workspace') {
      keys.add(folderWorkspaceKey(row.folderWorkspace.id))
    } else if (row.type === 'pending-creation') {
      keys.add(`pending:${row.creationId}`)
    } else if (row.type === 'imported-worktrees-card') {
      keys.add(row.key)
    } else if (row.type === 'new-external-worktrees-inbox') {
      keys.add(row.key)
    }
  }
  return keys
}

// Builds the grouped sidebar row model.
export function useSidebarSectionRows(args: SectionRowsArgs) {
  const { repos, worktrees, repoMap, effectiveCollapsedGroups } = args
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)

  // Why: manual header order is bound to state.repos; Recent/Smart derive order from the sorted worktree stream.
  const repoOrder = useMemo(
    () => getLogicalRepoOrderRankById(repos.map((repo) => repo.id)),
    [repos]
  )
  const allRepoIds = useMemo(() => repos.map((r) => r.id), [repos])
  const placeholderRepoIds = useMemo(
    () =>
      getEmptyProjectPlaceholderRepoIds({
        groupBy: args.groupBy,
        repos: args.visibleReposForRows,
        worktreesByRepo,
        visibleWorktrees: worktrees,
        filterRepoIds: args.filterRepoIds
      }),
    [args.filterRepoIds, args.groupBy, args.visibleReposForRows, worktrees, worktreesByRepo]
  )

  // Why: subscribe on a flat key array (useShallow) so progress ticks don't rebuild the whole row model.
  const pendingCreationKeys = useAppStore(
    useShallow((s) => selectPendingWorktreeCreationKeys(s.pendingWorktreeCreations))
  )
  const pendingCreations = useMemo(() => {
    // Why: a pending create names only its repo, so the page keeps the creates whose repo it lists.
    const pageRepoIds = args.hostPageId
      ? new Set(args.visibleReposForRows.map((repo) => repo.id))
      : null
    return pendingCreationKeys.flatMap((key) => {
      const separator = key.indexOf(' ')
      const repoId = key.slice(separator + 1)
      return pageRepoIds && !pageRepoIds.has(repoId)
        ? []
        : [{ creationId: key.slice(0, separator), repoId }]
    })
  }, [args.hostPageId, args.visibleReposForRows, pendingCreationKeys])

  const rows: Row[] = useMemo(
    () =>
      buildRows(
        args.groupBy,
        worktrees,
        repoMap,
        args.prCache,
        effectiveCollapsedGroups,
        repoOrder,
        args.workspaceStatuses,
        args.projectOrderBy,
        args.worktreeLineageById,
        args.worktreeMap,
        true,
        args.settings,
        args.visibleProjectGroupsForRows,
        placeholderRepoIds,
        args.importedWorktreesByRepo,
        args.newExternalWorktreesInboxByRepo,
        pendingCreations,
        args.projectGrouping,
        args.visibleFolderWorkspacesForRows,
        args.pinnedDisplayPolicy
      ),
    [
      args.groupBy,
      worktrees,
      repoMap,
      args.prCache,
      effectiveCollapsedGroups,
      repoOrder,
      args.workspaceStatuses,
      args.projectOrderBy,
      args.worktreeLineageById,
      args.worktreeMap,
      args.settings,
      args.projectGrouping,
      args.visibleProjectGroupsForRows,
      args.visibleFolderWorkspacesForRows,
      placeholderRepoIds,
      args.importedWorktreesByRepo,
      args.newExternalWorktreesInboxByRepo,
      pendingCreations,
      args.pinnedDisplayPolicy
    ]
  )
  const renderedSidebarRowKeys = useMemo(() => collectRenderedSidebarRowKeys(rows), [rows])

  return {
    rows,
    renderedSidebarRowKeys,
    allRepoIds,
    placeholderRepoIds
  }
}
