import type { DropdownActionKind } from '@/components/right-sidebar/source-control-dropdown-item-types'

export type PendingSourceControlAction = {
  kind: DropdownActionKind
  worktreeId: string
  requestedAt: number
}

// Why: the palette can't invoke the Source Control panel's action machinery
// directly (it lives in hooks with eligibility probes and progress UI), so it
// reveals the panel and parks an intent the panel consumes once mounted.
const INTENT_TTL_MS = 10_000

let pending: PendingSourceControlAction | null = null
const listeners = new Set<() => void>()

export function requestSourceControlAction(kind: DropdownActionKind, worktreeId: string): void {
  pending = { kind, worktreeId, requestedAt: Date.now() }
  for (const listener of listeners) {
    listener()
  }
}

/** Returns and clears the pending intent when it is still fresh and for this worktree. */
export function consumePendingSourceControlAction(
  worktreeId: string | null
): DropdownActionKind | null {
  if (!pending) {
    return null
  }
  const { kind, worktreeId: intentWorktreeId, requestedAt } = pending
  if (Date.now() - requestedAt > INTENT_TTL_MS || intentWorktreeId !== worktreeId) {
    pending = null
    return null
  }
  pending = null
  return kind
}

export function subscribePendingSourceControlAction(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function hasPendingSourceControlAction(): boolean {
  return pending !== null
}
