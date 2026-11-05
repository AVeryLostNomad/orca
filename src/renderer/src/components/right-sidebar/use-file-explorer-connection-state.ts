import { useMemo } from 'react'
import { useAppStore } from '@/store'
import {
  getFileExplorerOperationOwner,
  getFileExplorerOperationRoute
} from './file-explorer-operation-owner'

/** SSH state of the explorer's owner; listing waits out (re)connects and re-runs once connected. */
export function useFileExplorerConnectionState(activeWorktreeId: string | null): {
  connectionStatus: string | undefined
  connectionPending: boolean
} {
  // Why: owner changes remount the explorer, so the route is fixed per worktree here.
  const connectionId = useMemo(
    () =>
      getFileExplorerOperationRoute(getFileExplorerOperationOwner(activeWorktreeId))?.connectionId,
    [activeWorktreeId]
  )
  const connectionStatus = useAppStore((state) =>
    connectionId ? state.sshConnectionStates.get(connectionId)?.status : undefined
  )
  const connectionPending =
    connectionStatus === 'connecting' ||
    connectionStatus === 'deploying-relay' ||
    connectionStatus === 'reconnecting'
  return { connectionStatus, connectionPending }
}
