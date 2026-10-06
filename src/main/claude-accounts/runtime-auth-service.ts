import type { Store } from '../persistence'
import {
  getSelectedClaudeAccountIdForTarget,
  type ClaudeAccountSelectionTarget
} from './runtime-selection'
import { resolveProjectAgentAccountIdForCwd } from '../project-accounts/project-agent-account-pins'
import { ClaudeRuntimeAuthSync } from './runtime-auth/runtime-auth-sync'
import type { ClaudeRuntimeAuthPreparation } from './runtime-auth/runtime-auth-types'
import {
  getClaudePinnedAccountHomePath,
  linkSharedClaudeConfigIntoPinnedHome,
  readPinnedHomeCredentials,
  writePinnedHomeCredentials,
  writePinnedHomeGlobalConfig
} from './claude-pinned-account-home'

export type { ClaudeRuntimeAuthPreparation } from './runtime-auth/runtime-auth-types'

export class ClaudeRuntimeAuthService extends ClaudeRuntimeAuthSync {
  constructor(store: Store) {
    super(store)
    this.initializeLastSyncedState()
    void this.safeSyncForCurrentSelection()
  }

  async prepareForClaudeLaunch(
    target?: ClaudeAccountSelectionTarget,
    launchContext?: { workspacePath?: string }
  ): Promise<ClaudeRuntimeAuthPreparation> {
    // Why: a project/group pin runs that project's agents as their own account, isolated from the selection.
    const pinnedAccountId =
      target?.runtime === 'wsl'
        ? null
        : resolveProjectAgentAccountIdForCwd(
            this.store,
            launchContext?.workspacePath,
            'claudeAccountId'
          )
    const pinned = pinnedAccountId ? await this.prepareForPinnedClaudeLaunch(pinnedAccountId) : null
    if (pinned) {
      return pinned
    }
    const effectiveTarget = target ?? this.getDefaultAccountSelectionTarget()
    await this.syncForCurrentSelection(effectiveTarget)
    return this.getPreparation(effectiveTarget)
  }

  /**
   * Isolated launch for a project-pinned account that is not the current host
   * selection: it runs from its own config dir, so the shared login is untouched.
   * Null = the pin doesn't need isolation (unknown, WSL-only, or already selected).
   */
  async prepareForPinnedClaudeLaunch(
    accountId: string
  ): Promise<ClaudeRuntimeAuthPreparation | null> {
    return this.serializeMutation(async () => {
      const settings = this.store.getSettings()
      const account = this.getActiveAccount(settings.claudeManagedAccounts, accountId)
      if (
        !account ||
        account.managedAuthRuntime === 'wsl' ||
        getSelectedClaudeAccountIdForTarget(settings, { runtime: 'host' }) === account.id
      ) {
        return null
      }
      const homePath = getClaudePinnedAccountHomePath(account.id)
      const paths = this.pathResolver.getRuntimePaths()
      linkSharedClaudeConfigIntoPinnedHome(homePath, paths.configDir)
      const credentials = await this.readManagedCredentials(account)
      if (!credentials) {
        throw new Error(
          `The Claude account pinned for this project (${account.email}) has no saved login. Re-authenticate it in Settings.`
        )
      }
      if ((await readPinnedHomeCredentials(homePath)) !== credentials) {
        await writePinnedHomeCredentials(homePath, credentials)
      }
      writePinnedHomeGlobalConfig(
        homePath,
        paths.configPath,
        await this.readManagedOauthAccount(account)
      )
      return {
        configDir: homePath,
        runtime: 'host',
        wslDistro: null,
        wslLinuxConfigDir: null,
        envPatch: { CLAUDE_CONFIG_DIR: homePath },
        stripAuthEnv: true,
        provenance: `managed:${account.id}:project-pin`
      }
    })
  }

  async prepareForRateLimitFetch(
    target?: ClaudeAccountSelectionTarget
  ): Promise<ClaudeRuntimeAuthPreparation> {
    const effectiveTarget = target ?? this.getDefaultAccountSelectionTarget()
    await this.syncForCurrentSelection(effectiveTarget)
    return this.getPreparation(effectiveTarget)
  }

  async syncForCurrentSelection(target?: ClaudeAccountSelectionTarget): Promise<void> {
    await this.serializeMutation(() =>
      this.doSyncForCurrentSelection(target ?? this.getDefaultAccountSelectionTarget())
    )
  }

  async forceMaterializeCurrentSelectionForRollback(): Promise<void> {
    await this.serializeMutation(async () => {
      const settings = this.store.getSettings()
      if (!settings.activeClaudeManagedAccountId) {
        const previousAccount = this.getActiveAccount(
          settings.claudeManagedAccounts,
          this.lastSyncedAccountId
        )
        await this.restoreSystemDefaultSnapshot(
          previousAccount ? await this.readManagedCredentials(previousAccount) : null,
          previousAccount ? await this.readManagedOauthAccount(previousAccount) : undefined
        )
        this.lastSyncedAccountId = null
        return
      }
      await this.doSyncForCurrentSelection()
    })
  }

  getRuntimeConfigDir(target?: ClaudeAccountSelectionTarget): string {
    return this.getPreparation(target).configDir
  }

  private initializeLastSyncedState(): void {
    const settings = this.store.getSettings()
    this.lastSyncedAccountId = getSelectedClaudeAccountIdForTarget(settings, { runtime: 'host' })
  }

  private async safeSyncForCurrentSelection(): Promise<void> {
    try {
      await this.syncForCurrentSelection()
    } catch (error) {
      console.warn('[claude-runtime-auth] Failed to sync runtime auth state:', error)
    }
  }

  private serializeMutation<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(fn, fn)
    this.mutationQueue = next.catch(() => {})
    return next
  }

  // Why: re-auth/add-account write fresh managed tokens; skip the next read-back so stale runtime tokens can't overwrite them.
  clearLastWrittenCredentialsJson(
    accountId = this.store.getSettings().activeClaudeManagedAccountId
  ): void {
    if (accountId === this.store.getSettings().activeClaudeManagedAccountId) {
      this.lastWrittenCredentialsJson = null
    }
    this.skipNextReadBackForAccountId = accountId
  }
}
