export type LspServerId =
  | 'typescript'
  | 'json'
  | 'css'
  | 'html'
  | 'yaml'
  | 'pyright'
  | 'bash'
  | 'dockerfile'
  | 'intelephense'
  | 'vue'
  | 'rust-analyzer'
  | 'clangd'
  | 'lua'
  | 'marksman'
  | 'taplo'
  | 'terraform'
  | 'gopls'

export type LspServerInstallState =
  | { phase: 'not-installed' }
  | { phase: 'installing'; progress: number }
  | { phase: 'installed'; version: string }
  | { phase: 'error'; message: string }
  | { phase: 'toolchain-missing'; toolchain: string }

export type LspSessionStatus = 'installing' | 'starting' | 'ready' | 'error' | 'stopped'

export type LspEnsureSessionArgs = {
  serverId: LspServerId
  rootPath: string
}

export type LspEnsureSessionResult =
  | {
      ok: true
      sessionId: string
      status: LspSessionStatus
      /** Bumped on every (re)initialize; clients re-send didOpen when it grows. */
      epoch: number
      serverCapabilities: unknown
    }
  | { ok: false; error: string }

export type LspResponseError = { code: number; message: string; data?: unknown }

export type LspRequestResult =
  | { ok: true; result: unknown }
  | { ok: false; error: LspResponseError }

export type LspSessionEvent =
  | { kind: 'notification'; method: string; params: unknown }
  | { kind: 'serverRequest'; serverRequestId: number; method: string; params: unknown }
  | { kind: 'status'; status: LspSessionStatus; epoch: number; error?: string }

export type LspServerStateSnapshot = {
  serverId: LspServerId
  displayName: string
  languageIds: string[]
  install: LspServerInstallState
  activeSessions: number
}

/** JSON-RPC error code the main process uses for a renderer-cancelled request. */
export const LSP_REQUEST_CANCELLED_CODE = -32800
