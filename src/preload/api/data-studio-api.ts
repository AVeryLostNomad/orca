import type {
  DataStudioEnsureRunningResult,
  DataStudioStatusEvent
} from '../../shared/data-studio-types'

// Guest keyboard forwarding reuses CodeServerApi.registerGuest/unregisterGuest —
// the Data Studio guest is the same workbench UI.
export type DataStudioApi = {
  ensureRunning: (args: {
    repoId: string
    repoPath?: string
  }) => Promise<DataStudioEnsureRunningResult | { error: string }>
  retry: (args: { repoId: string }) => Promise<DataStudioEnsureRunningResult | { error: string }>
  release: (args: { repoId: string }) => Promise<void>
  getStatus: (args: { repoId: string }) => Promise<DataStudioStatusEvent | null>
  onStatusChanged: (callback: (event: DataStudioStatusEvent) => void) => () => void
}
