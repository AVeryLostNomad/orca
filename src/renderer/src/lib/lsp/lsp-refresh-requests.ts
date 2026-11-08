import { registerLspServerRequestHandler } from './lsp-client'

const REFRESH_KINDS = ['codeLens', 'inlayHint', 'semanticTokens'] as const
type LspRefreshKind = (typeof REFRESH_KINDS)[number]

const listenersByKind: Record<LspRefreshKind, (() => void)[]> = {
  codeLens: [],
  inlayHint: [],
  semanticTokens: []
}
let handlersInstalled = false

/** Run `listener` whenever any server sends workspace/<kind>/refresh.
 *  Providers are per-language singletons, so listeners are never removed;
 *  Monaco only re-queries models visible in editors. */
export function onLspRefreshRequest(kind: LspRefreshKind, listener: () => void): void {
  listenersByKind[kind].push(listener)
  if (handlersInstalled) {
    return
  }
  handlersInstalled = true
  for (const refreshKind of REFRESH_KINDS) {
    registerLspServerRequestHandler(`workspace/${refreshKind}/refresh`, async () => {
      for (const fire of listenersByKind[refreshKind]) {
        fire()
      }
      return null
    })
  }
}
