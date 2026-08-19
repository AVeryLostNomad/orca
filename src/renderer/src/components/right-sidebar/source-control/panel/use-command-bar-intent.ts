import { useEffect, useRef } from 'react'
import type { DropdownActionKind } from '../../source-control-dropdown-item-types'
import {
  consumePendingSourceControlAction,
  subscribePendingSourceControlAction
} from '@/components/cmd-j/source-control-command-bridge'

/**
 * Consumes a command-bar intent ("push", "create pr", …) once the panel is
 * mounted and its remote status has resolved, then routes it through the same
 * dispatcher every panel entry point uses. Stale/mismatched intents expire in
 * the bridge instead of firing against the wrong worktree.
 */
export function useCommandBarSourceControlIntent(args: {
  activeWorktreeId: string | null
  remoteStatusLoaded: boolean
  handleActionInvoke: (kind: DropdownActionKind) => void
}): void {
  const { activeWorktreeId, remoteStatusLoaded, handleActionInvoke } = args
  const invokeRef = useRef(handleActionInvoke)
  invokeRef.current = handleActionInvoke

  useEffect(() => {
    if (!remoteStatusLoaded) {
      return
    }
    const tryConsume = (): void => {
      const kind = consumePendingSourceControlAction(activeWorktreeId)
      if (kind) {
        invokeRef.current(kind)
      }
    }
    tryConsume()
    return subscribePendingSourceControlAction(tryConsume)
  }, [activeWorktreeId, remoteStatusLoaded])
}
