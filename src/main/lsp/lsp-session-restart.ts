import type { LspServerId } from '../../shared/lsp-types'
import type { LspSession } from './lsp-session'
import {
  LSP_MAX_RESTART_ATTEMPTS,
  LSP_RESTART_BACKOFF_MS,
  LSP_RESTART_STABILITY_MS,
  type ManagedLspSession
} from './lsp-managed-session-state'

export type LspRestartHooks = {
  isShuttingDown: () => boolean
  emitStatus: (managed: ManagedLspSession) => void
  start: (managed: ManagedLspSession) => Promise<void>
}

/** Take the live session out of `managed`; a pending stability reset must not
 *  outlive the session it was measuring. */
export function detachLspSession(managed: ManagedLspSession): LspSession | null {
  const session = managed.session
  managed.session = null
  if (managed.stabilityTimer) {
    clearTimeout(managed.stabilityTimer)
    managed.stabilityTimer = null
  }
  return session
}

/** After a restart, only clean uptime counts as recovered. */
export function armLspRestartStabilityTimer(managed: ManagedLspSession): void {
  if (managed.restartAttempts === 0) {
    return
  }
  managed.stabilityTimer = setTimeout(() => {
    managed.stabilityTimer = null
    managed.restartAttempts = 0
  }, LSP_RESTART_STABILITY_MS)
}

/** Crash recovery with backoff; gives up after LSP_MAX_RESTART_ATTEMPTS. */
export function scheduleLspCrashRestart(managed: ManagedLspSession, hooks: LspRestartHooks): void {
  if (managed.restartAttempts >= LSP_MAX_RESTART_ATTEMPTS) {
    managed.status = 'error'
    managed.lastError = 'language server crashed repeatedly'
    hooks.emitStatus(managed)
    return
  }
  const delay = LSP_RESTART_BACKOFF_MS[managed.restartAttempts] ?? 8000
  managed.restartAttempts += 1
  managed.status = 'starting'
  hooks.emitStatus(managed)
  managed.restartTimer = setTimeout(() => {
    managed.restartTimer = null
    if (hooks.isShuttingDown() || managed.session || managed.starting) {
      return
    }
    managed.starting = hooks
      .start(managed)
      .catch(() => {
        // emitStatus already reported the failure.
      })
      .finally(() => {
        managed.starting = null
      })
  }, delay)
}

/** Re-spawn every live session of a server (e.g. after project files were
 *  regenerated); clients re-send didOpen on the epoch bump. */
export async function restartLspServerSessions(
  sessions: Iterable<ManagedLspSession>,
  serverId: LspServerId,
  hooks: LspRestartHooks
): Promise<void> {
  const restarts: Promise<void>[] = []
  for (const managed of sessions) {
    if (managed.serverId !== serverId || !managed.session || managed.starting) {
      continue
    }
    const old = detachLspSession(managed)
    managed.restartAttempts = 0
    const starting = (old?.dispose() ?? Promise.resolve())
      .then(() => hooks.start(managed))
      .finally(() => {
        managed.starting = null
      })
    managed.starting = starting
    restarts.push(
      starting.catch(() => {
        // emitStatus already reported the failure.
      })
    )
  }
  await Promise.all(restarts)
}
