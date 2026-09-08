import type { AppState } from '../types'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import {
  resolveTerminalHostOwnership,
  resolveTerminalWorktreeRoute
} from '@/lib/terminal-worktree-route'
import {
  classifyTerminalRetirementWorktree,
  type TerminalTabRetirementPlan
} from '../slices/terminal-tab-retirement'

export function startTerminalTabProviderRetirement({
  localPtyTeardownOwnedExternally,
  remoteCloseOwnedByHost,
  retirementPlan,
  state,
  tabId
}: {
  localPtyTeardownOwnedExternally: boolean
  remoteCloseOwnedByHost: boolean
  retirementPlan: TerminalTabRetirementPlan
  state: AppState
  tabId: string
}): void {
  const fallbackWorktreeRoute = retirementPlan.worktreeId
    ? resolveTerminalWorktreeRoute(state, retirementPlan.worktreeId)
    : { runtimeEnvironmentId: null }
  const hostOwnership = resolveTerminalHostOwnership(state, retirementPlan.worktreeId, 'teardown')
  const topologyRetirementTask =
    hostOwnership.kind === 'local-or-ssh' && retirementPlan.worktreeId && window.api.pty.retireTab
      ? window.api.pty.retireTab(retirementPlan.worktreeId, tabId)
      : null
  const retirementTasks: Promise<unknown>[] = localPtyTeardownOwnedExternally
    ? []
    : retirementPlan.localOrSshPtyIds.map(async (ptyId) => window.api.pty.kill(ptyId))
  const localOrSshTaskCount = retirementTasks.length
  if (!remoteCloseOwnedByHost) {
    for (const terminal of retirementPlan.runtimeTerminals) {
      if (!terminal.environmentId && !fallbackWorktreeRoute) {
        continue
      }
      const environmentId = terminal.environmentId ?? fallbackWorktreeRoute?.runtimeEnvironmentId
      retirementTasks.push(
        callRuntimeRpc(
          environmentId ? { kind: 'environment', environmentId } : { kind: 'local' },
          'terminal.close',
          { terminal: terminal.handle }
        )
      )
    }
  }
  if (retirementPlan.unroutablePtyIds.length > 0) {
    // Log the worktree shape, never its id, because worktree ids embed absolute paths.
    console.warn('[terminal-retirement] skipped PTYs with no resolvable owner', {
      tabId,
      worktreeKind: classifyTerminalRetirementWorktree(retirementPlan.worktreeId),
      count: retirementPlan.unroutablePtyIds.length
    })
  }
  const tasks = topologyRetirementTask
    ? [topologyRetirementTask, ...retirementTasks]
    : retirementTasks
  // Close remains synchronous; provider failures cannot block ownership revocation.
  void Promise.allSettled(tasks).then((results) => {
    const topologyOffset = topologyRetirementTask ? 1 : 0
    const topologyFailures = topologyRetirementTask && results[0]?.status === 'rejected' ? 1 : 0
    const localOrSshFailures = results
      .slice(topologyOffset, topologyOffset + localOrSshTaskCount)
      .filter((result) => result.status === 'rejected').length
    const runtimeFailures = results
      .slice(topologyOffset + localOrSshTaskCount)
      .filter((result) => result.status === 'rejected').length
    if (topologyFailures > 0 || localOrSshFailures > 0 || runtimeFailures > 0) {
      console.warn('[terminal-retirement] provider teardown failed', {
        tabId,
        ...(topologyFailures > 0 ? { topologyFailures } : {}),
        localOrSshFailures,
        runtimeFailures
      })
    }
  })
}
