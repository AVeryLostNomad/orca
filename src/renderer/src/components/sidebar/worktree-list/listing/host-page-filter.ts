import type { ExecutionHostId } from '../../../../../../shared/execution-host'
import type { SidebarFilterState } from '../../sidebar-filter-actions'

/** A host page narrows every row source to its host; the Hosts filter only decides which pages exist. */
export function scopeFilterStateToHostPage<T extends SidebarFilterState>(
  filterState: T,
  hostPageId: ExecutionHostId | undefined
): T {
  return hostPageId
    ? { ...filterState, visibleWorkspaceHostIds: [hostPageId], workspaceHostScope: hostPageId }
    : filterState
}
