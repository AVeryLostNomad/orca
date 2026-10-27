import {
  captureRuntimeEnvironmentRequestRevision,
  getRuntimeEnvironmentRevision
} from '@/runtime/runtime-environment-revision'
import type { AppState } from '../types'
import { callRuntimeRpc, ensureRuntimeEnvironmentCompatible } from '@/runtime/runtime-rpc-client'
import {
  resolveTerminalPtyOwner,
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
  tabId,
  canRetireRuntimeTerminal
}: {
  localPtyTeardownOwnedExternally: boolean
  remoteCloseOwnedByHost: boolean
  retirementPlan: TerminalTabRetirementPlan
  state: AppState
  tabId: string
  canRetireRuntimeTerminal?: () => boolean
}): void {
  const { worktreeId } = retirementPlan
  // Why: an unscoped `remote:` id of an unattributable twin must not be closed on this app.
  const fallbackWorktreeRoute = !worktreeId
    ? { runtimeEnvironmentId: null }
    : resolveTerminalPtyOwner(state, worktreeId, 'spawn').kind === 'ambiguous'
      ? null
      : resolveTerminalWorktreeRoute(state, worktreeId)
  // Windows daemons can miss the kill; durably retire the desktop tab independently of provider teardown.
  const topologyRetirementTask =
    worktreeId &&
    resolveTerminalPtyOwner(state, worktreeId, 'teardown').kind === 'non-runtime' &&
    window.api.pty.retireTab
      ? window.api.pty.retireTab(worktreeId, tabId)
      : null
  const retirementTasks: Promise<unknown>[] = localPtyTeardownOwnedExternally
    ? []
    : retirementPlan.localOrSshPtyIds.map(async (ptyId) => window.api.pty.kill(ptyId))
  const localOrSshTaskCount = retirementTasks.length
  let unroutableRuntimeTerminalCount = 0
  if (!remoteCloseOwnedByHost) {
    for (const terminal of retirementPlan.runtimeTerminals) {
      if (!terminal.environmentId && !fallbackWorktreeRoute) {
        unroutableRuntimeTerminalCount += 1
        continue
      }
      const environmentId = terminal.environmentId ?? fallbackWorktreeRoute?.runtimeEnvironmentId
      retirementTasks.push(
        retireRuntimeTerminal(environmentId, terminal.handle, canRetireRuntimeTerminal)
      )
    }
  }
  const unroutableCount = retirementPlan.unroutablePtyIds.length + unroutableRuntimeTerminalCount
  if (unroutableCount > 0) {
    // Log the worktree shape, never its id, because worktree ids embed absolute paths.
    console.warn('[terminal-retirement] skipped PTYs with no resolvable owner', {
      tabId,
      worktreeKind: classifyTerminalRetirementWorktree(retirementPlan.worktreeId),
      count: unroutableCount
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

async function retireRuntimeTerminal(
  environmentId: string | null | undefined,
  handle: string,
  canRetire?: () => boolean
): Promise<unknown> {
  const target = environmentId
    ? { kind: 'environment' as const, environmentId }
    : { kind: 'local' as const }
  if (!canRetire) {
    return callRuntimeRpc(target, 'terminal.close', { terminal: handle })
  }
  const revision = environmentId
    ? captureRuntimeEnvironmentRequestRevision(environmentId)
    : undefined
  if (environmentId) {
    await ensureRuntimeEnvironmentCompatible(environmentId, {
      expectedEnvironmentPairingRevision: revision
    })
  }
  if (
    (environmentId && getRuntimeEnvironmentRevision(environmentId) !== revision) ||
    !canRetire()
  ) {
    return
  }
  // Compatibility was checked above; recheck pane ownership at the actual dispatch boundary.
  return callRuntimeRpc(
    target,
    'terminal.close',
    { terminal: handle },
    {
      skipCompatibilityCheck: true,
      expectedEnvironmentPairingRevision: revision
    }
  )
}
