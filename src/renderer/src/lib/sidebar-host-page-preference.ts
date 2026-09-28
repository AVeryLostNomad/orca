// Why: which host page the sidebar shows is a per-device viewing preference —
// keep it out of persisted UI state, which paired web clients share with the host.
import {
  LOCAL_EXECUTION_HOST_ID,
  normalizeExecutionHostId,
  type ExecutionHostId
} from '../../../shared/execution-host'

const STORAGE_KEY = 'orca.sidebar.hostPage'

export function loadSidebarHostPageId(): ExecutionHostId {
  try {
    return (
      normalizeExecutionHostId(window.localStorage.getItem(STORAGE_KEY)) ?? LOCAL_EXECUTION_HOST_ID
    )
  } catch {
    return LOCAL_EXECUTION_HOST_ID
  }
}

export function saveSidebarHostPageId(hostId: ExecutionHostId): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, hostId)
  } catch {
    // localStorage may be disabled — the page just won't persist this session.
  }
}
