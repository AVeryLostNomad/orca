import type { LspServerId, LspSessionStatus } from '../../shared/lsp-types'
import type { LspSession } from './lsp-session'

export const LSP_MAX_RESTART_ATTEMPTS = 3
export const LSP_RESTART_BACKOFF_MS = [500, 2000, 8000]
export const LSP_DEFAULT_IDLE_SHUTDOWN_MS = 5 * 60_000
// A restart only counts as recovered after this much clean uptime; resetting
// sooner would let a crash-loop that initializes fine restart forever.
export const LSP_RESTART_STABILITY_MS = 60_000

export type ManagedLspSession = {
  sessionId: string
  serverId: LspServerId
  rootPath: string
  session: LspSession | null
  status: LspSessionStatus
  lastError: string | undefined
  epoch: number
  starting: Promise<void> | null
  subscriberWebContentsIds: Set<number>
  restartAttempts: number
  idleTimer: NodeJS.Timeout | null
  restartTimer: NodeJS.Timeout | null
  stabilityTimer: NodeJS.Timeout | null
}

export function lspSessionKey(serverId: LspServerId, rootPath: string): string {
  return `${serverId} ${rootPath}`
}

export function createManagedLspSession(
  sessionId: string,
  serverId: LspServerId,
  rootPath: string
): ManagedLspSession {
  return {
    sessionId,
    serverId,
    rootPath,
    session: null,
    status: 'installing',
    lastError: undefined,
    epoch: 0,
    starting: null,
    subscriberWebContentsIds: new Set(),
    restartAttempts: 0,
    idleTimer: null,
    restartTimer: null,
    stabilityTimer: null
  }
}

export function clearManagedLspSessionTimers(managed: ManagedLspSession): void {
  for (const key of ['idleTimer', 'restartTimer', 'stabilityTimer'] as const) {
    const timer = managed[key]
    if (timer) {
      clearTimeout(timer)
      managed[key] = null
    }
  }
}

export function clearLspIdleTimer(managed: ManagedLspSession): void {
  if (managed.idleTimer) {
    clearTimeout(managed.idleTimer)
    managed.idleTimer = null
  }
}

/** Arm the idle-shutdown timer; onIdleStop fires only when nothing holds the
 *  session anymore (no open documents, or no subscriber left to close them). */
export function armLspIdleTimer(
  managed: ManagedLspSession,
  idleMs: number,
  onIdleStop: () => void
): void {
  clearLspIdleTimer(managed)
  managed.idleTimer = setTimeout(() => {
    managed.idleTimer = null
    const noDocuments = (managed.session?.openDocuments.size ?? 0) === 0
    const noSubscribers = managed.subscriberWebContentsIds.size === 0
    if (noDocuments || noSubscribers) {
      onIdleStop()
    }
  }, idleMs)
}
