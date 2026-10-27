import type { ProjectCatalogReadState } from '@/store/project-host-setup-selector'
import {
  localhostLabelRouteForHttpLink,
  openLabeledLocalhostLink,
  type LocalhostLinkWorktree
} from './http-link-localhost-route'
import { parseLoopbackHttpUrl } from '../../../shared/localhost-worktree-labels'
import type { WorkspacePortScanResult } from '../../../shared/workspace-ports'

import type { BrowserLinkOpenContext } from './browser-link-destination'
import type { LinkOpenIntent, LinkSourceState } from './link-open-intent'
import { captureLinkOpenIntent, canOpenLinkInSourceGroup } from './link-open-intent'
import type { AppState } from '@/store/types'
import { isFloatingWorkspaceId } from '../../../shared/floating-workspace-worktree'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import { resolveModifierRouting } from './http-link-modifier-routing'
import { openSystemHttpLink, reportHttpLinkBrowserOpenFailure } from './http-link-open-failure'
import type { ExecutionHostId } from '../../../shared/execution-host'
import { reselectWorkspaceKeepingHost } from './active-workspace-host'
import {
  captureBrowserLinkReveal,
  type BrowserLinkSelectionSubscriber
} from './browser-link-reveal'
import {
  isHttpLinkBackgroundOpen,
  openLocalHttpLinkTab,
  prepareRemoteHttpLinkTab,
  type HttpLinkBrowserRequestFields,
  type HttpLinkBrowserTabState
} from './http-link-browser-placement'

export type OpenHttpLinkOptions = {
  worktreeId?: string | null
  /** Lets a remote-owned source use its managed browser for non-loopback URLs. */
  allowRemoteInApp?: boolean
  /** Preserve a source surface's existing desktop-browser provider for remote documents. */
  allowClientBrowserFallback?: boolean
  /** Unconditional: always use the system browser regardless of settings. */
  forceSystemBrowser?: boolean
  /** Unconditional for local sources: open inside Orca regardless of settings. */
  forceInApp?: boolean
  /** The Shift escape-hatch modifier was held; resolveModifierRouting decides what it means. */
  modifierHeld?: boolean
  sourceOwner?: HttpLinkSourceOwner
  linkContext?: BrowserLinkOpenContext
}

export type HttpLinkSourceOwner =
  | { kind: 'local' }
  | { kind: 'runtime'; runtimeEnvironmentId: string }
  | { kind: 'ssh'; connectionId: string }
  | { kind: 'unknown' }

export type HttpLinkStoreState = ProjectCatalogReadState &
  HttpLinkBrowserTabState & {
    unifiedTabsByWorktree?: LinkSourceState['unifiedTabsByWorktree']
    groupsByWorktree?: AppState['groupsByWorktree']
    layoutByWorktree?: AppState['layoutByWorktree']
    settings?: Partial<
      Pick<
        GlobalSettings,
        | 'openLinksInAppInBackground'
        | 'openLinksInApp'
        | 'openLinksInAppModifierInverts'
        | 'activeRuntimeEnvironmentId'
        | 'localhostWorktreeLabelsEnabled'
      >
    > | null
    setActiveWorktree: (worktreeId: string, executionHostId?: ExecutionHostId) => void
    activeWorktreeId?: string | null
    activeWorkspaceExecutionHostId?: ExecutionHostId | null
    worktreesByRepo?: Record<string, LocalhostLinkWorktree[]>
    allWorktrees?: () => LocalhostLinkWorktree[]
    workspacePortScan?: { result: WorkspacePortScanResult } | null
    workspacePortScansByKey?: Record<string, WorkspacePortScanResult>
  }

export type HttpLinkGroupActionRequest = {
  workspaceId: string
  sourceTabId?: string | null
  url?: string
  sourceOwner?: HttpLinkSourceOwner
}
let groupActionAvailability: ((request: HttpLinkGroupActionRequest) => boolean) | null = null
export function registerHttpLinkGroupActionAvailability(
  check: (request: HttpLinkGroupActionRequest) => boolean
): void {
  groupActionAvailability = check
}

type StoreAccessor = () => HttpLinkStoreState

type WorkspaceHttpLinkBrowserRequest = HttpLinkBrowserRequestFields & {
  workspaceId: string
  url: string
  intent: { kind: 'url' }
  linkContext?: BrowserLinkOpenContext
  expectedRuntimeEnvironmentId?: string
  expectedSshConnectionId?: string
  allowClientBrowserFallback?: boolean
}

/** Resolves to the page id when the page renders on this desktop, else null. */
type WorkspaceHttpLinkBrowserOpener = (
  request: WorkspaceHttpLinkBrowserRequest
) => Promise<string | null | void>

// Inject store access to break editor-slice → HTTP routing → store initialization cycles.
let storeAccessor: StoreAccessor | null = null
let storeSubscriber: BrowserLinkSelectionSubscriber | undefined
let workspaceHttpLinkBrowserOpener: WorkspaceHttpLinkBrowserOpener | null = null

export function registerHttpLinkStoreAccessor(
  fn: StoreAccessor,
  subscribe?: BrowserLinkSelectionSubscriber
): void {
  storeAccessor = fn
  storeSubscriber = subscribe
}

export function registerWorkspaceHttpLinkBrowserOpener(
  fn: WorkspaceHttpLinkBrowserOpener | null
): void {
  workspaceHttpLinkBrowserOpener = fn
}

export function captureHttpLinkIntent(
  workspaceId: string,
  sourceTabId?: string | null,
  explicitSourceGroup = false
): LinkOpenIntent | null {
  const state = storeAccessor?.()
  return state
    ? captureLinkOpenIntent(state, workspaceId, sourceTabId, { explicitSourceGroup })
    : null
}

export function canHttpLinkOpenInSourceGroup(
  workspaceId: string,
  sourceTabId?: string | null,
  url?: string,
  sourceOwner?: HttpLinkSourceOwner
): boolean {
  const state = storeAccessor?.()
  if (
    groupActionAvailability &&
    !groupActionAvailability({ workspaceId, sourceTabId, url, sourceOwner })
  ) {
    return false
  }
  return state ? canOpenLinkInSourceGroup(state, workspaceId, sourceTabId) : false
}

// Route only external http(s); file/markdown targets stay with resolveMarkdownLinkTarget. Modifier-held resolves the user’s Shift choice; forceSystemBrowser is unconditional.
export function openHttpLink(url: string, opts: OpenHttpLinkOptions = {}): void {
  // Ownerless legacy callers retain their default-server classification without asserting an owner.
  const ownerlessRemoteActive =
    !opts.sourceOwner && Boolean(storeAccessor?.()?.settings?.activeRuntimeEnvironmentId?.trim())
  executeHttpLink(url, opts, ownerlessRemoteActive)
}

export function openOwnedHttpLink(
  url: string,
  opts: OpenHttpLinkOptions & { sourceOwner: HttpLinkSourceOwner }
): void {
  executeHttpLink(url, opts, false)
}

function executeHttpLink(
  url: string,
  opts: OpenHttpLinkOptions,
  remoteRuntimeActive: boolean
): void {
  if (opts.linkContext?.isCurrentRequest?.() === false) {
    return
  }
  const { worktreeId, allowRemoteInApp, forceSystemBrowser, forceInApp, sourceOwner } = opts
  if (sourceOwner?.kind === 'unknown') {
    return
  }
  const state = storeAccessor?.()
  const effectiveSourceOwner = sourceOwner
  const sourceIsLocal = effectiveSourceOwner
    ? effectiveSourceOwner.kind === 'local'
    : !remoteRuntimeActive
  const openLinksInApp = state?.settings?.openLinksInApp === true
  const modifier = resolveModifierRouting(
    Boolean(opts.modifierHeld),
    openLinksInApp,
    state?.settings?.openLinksInAppModifierInverts === true
  )
  // Remote loopback only resolves on the owning host, so it defaults to that host's browser.
  const remoteLoopbackWithWorkspace =
    Boolean(worktreeId) &&
    (effectiveSourceOwner?.kind === 'runtime' || effectiveSourceOwner?.kind === 'ssh') &&
    parseLoopbackHttpUrl(url) !== null
  const wantsOrca =
    !forceSystemBrowser &&
    !modifier.wantsSystemBrowser &&
    Boolean(worktreeId) &&
    (forceInApp || openLinksInApp || modifier.wantsOrca || remoteLoopbackWithWorkspace)

  if (
    wantsOrca &&
    worktreeId &&
    (effectiveSourceOwner?.kind === 'runtime' ||
      effectiveSourceOwner?.kind === 'ssh' ||
      (!effectiveSourceOwner && remoteRuntimeActive)) &&
    (allowRemoteInApp || remoteLoopbackWithWorkspace)
  ) {
    if (workspaceHttpLinkBrowserOpener && state) {
      const fields = prepareRemoteHttpLinkTab(state, worktreeId)
      const reveal = captureBrowserLinkReveal(
        () => storeAccessor?.() ?? state,
        storeSubscriber,
        opts.linkContext?.canReveal
      )
      void workspaceHttpLinkBrowserOpener({
        workspaceId: worktreeId,
        url,
        intent: { kind: 'url' },
        ...fields,
        linkContext: { linkIntent: null, ...opts.linkContext, canReveal: reveal.canReveal },
        ...(opts.allowClientBrowserFallback ? { allowClientBrowserFallback: true } : {}),
        ...(effectiveSourceOwner?.kind === 'runtime'
          ? { expectedRuntimeEnvironmentId: effectiveSourceOwner.runtimeEnvironmentId }
          : effectiveSourceOwner?.kind === 'ssh'
            ? { expectedSshConnectionId: effectiveSourceOwner.connectionId }
            : {})
      })
        .catch((error: unknown) => {
          // Why: loopback went in-app only by default; hosts that cannot route it (SSH routing off,
          // runtimes without browser streaming) keep the client browser their port forwards serve.
          if (!(forceInApp || openLinksInApp || modifier.wantsOrca)) {
            void openSystemHttpLink(url)
            return
          }
          reportHttpLinkBrowserOpenFailure(error)
        })
        .finally(reveal.dispose)
      return
    }
    if (!remoteLoopbackWithWorkspace) {
      return
    }
  }

  if (wantsOrca && sourceIsLocal && worktreeId && state) {
    const getState = () => storeAccessor?.() ?? state
    const reveal = captureBrowserLinkReveal(getState, storeSubscriber, opts.linkContext?.canReveal)
    const openLocal = (chosenUrl: string): void => {
      if (opts.linkContext?.isCurrentRequest?.() === false) {
        reveal.dispose()
        return
      }
      if (workspaceHttpLinkBrowserOpener) {
        void workspaceHttpLinkBrowserOpener({
          workspaceId: worktreeId,
          url: chosenUrl,
          intent: { kind: 'url' },
          linkContext: { linkIntent: null, ...opts.linkContext, canReveal: reveal.canReveal },
          ...(isHttpLinkBackgroundOpen(state)
            ? { focusOnCreate: false, selectWorktree: false }
            : {})
        })
          .catch(reportHttpLinkBrowserOpenFailure)
          .finally(reveal.dispose)
        return
      }
      const activate = !isHttpLinkBackgroundOpen(state) && reveal.canReveal()
      reveal.dispose()
      if (activate && !isFloatingWorkspaceId(worktreeId)) {
        reselectWorkspaceKeepingHost(state, worktreeId)
      }
      openLocalHttpLinkTab(getState(), worktreeId, chosenUrl, undefined, activate)
    }
    const localhostRoute = localhostLabelRouteForHttpLink(url, state, sourceOwner)
    if (!localhostRoute) {
      openLocal(url)
      return
    }
    void openLabeledLocalhostLink(url, localhostRoute, openLocal)
    return
  }

  const localhostRoute = state ? localhostLabelRouteForHttpLink(url, state, sourceOwner) : null
  if (!localhostRoute) {
    void openSystemHttpLink(url)
    return
  }
  void openLabeledLocalhostLink(url, localhostRoute, (labeledUrl) => {
    if (opts.linkContext?.isCurrentRequest?.() === false) {
      return
    }
    void openSystemHttpLink(labeledUrl)
  })
}

export async function resolveLocalhostHttpLinkDisplayUrl(
  url: string,
  sourceOwner?: HttpLinkSourceOwner
): Promise<string | null> {
  const state = storeAccessor?.()
  if (!state) {
    return null
  }
  // Resolve hover and click through the same route so remote loopback cannot borrow a local workspace label.
  const localhostRoute = localhostLabelRouteForHttpLink(url, state, sourceOwner)
  if (!localhostRoute) {
    return null
  }
  try {
    const result = await window.api.localhostWorktreeLabels.register(localhostRoute)
    return result.url
  } catch {
    return null
  }
}
