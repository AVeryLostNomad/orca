import type { LspServerId, LspServerStateSnapshot } from '../../shared/lsp-types'
import { getLspInstallState } from './lsp-server-acquisition'
import { getLspServerRegistry, lspServerLanguageIds } from './lsp-server-registry'

/** Settings-pane view of every known server plus its live session count. */
export function snapshotLspServerStates(
  activeSessionCounts: ReadonlyMap<LspServerId, number>
): LspServerStateSnapshot[] {
  return getLspServerRegistry().map((entry) => ({
    serverId: entry.id,
    displayName: entry.displayName,
    languageIds: lspServerLanguageIds(entry.id),
    install: getLspInstallState(entry.id),
    activeSessions: activeSessionCounts.get(entry.id) ?? 0
  }))
}
