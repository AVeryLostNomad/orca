# Embedded VSCode (code-server) — Design

**Date:** 2026-07-05
**Status:** Approved design, pending implementation plan

## Goal

Let users open an embedded VSCode editor inside Orca — via a "New VSCode Tab" entry
alongside "New Browser Tab" — that opens the current Orca workspace (worktree) in a
full VS Code web workbench. The editor is served by [code-server](https://github.com/coder/code-server)
and rendered in an Electron `<webview>`, mirroring how the embedded browser works.

## Non-goals (v1)

- **Windows support.** code-server publishes no Windows releases; the feature is hidden on Windows.
- **Remote / SSH worktrees.** v1 runs code-server only for local worktrees. The main-process
  module is structured behind an interface so a remote provider (deploy-on-host + port-forward,
  the SSH-relay pattern) can be added later without a rewrite.
- **Microsoft extension marketplace.** code-server uses Open VSX; pointing `EXTENSIONS_GALLERY`
  at Microsoft's marketplace violates their ToS. Documented as a known limitation.

## Approach

A dedicated `vscode` tab type rendered by a dedicated pane that **reuses the existing
`<webview>` machinery** (creation, registry, partition) with no browser chrome. A new
main-process module owns code-server acquisition, the shared server process, and the port.
The webview points at `http://127.0.0.1:<port>/?folder=<worktree.path>`.

Rejected alternatives: reusing the browser tab wholesale (wrong UX — address bar/nav, page
semantics, can navigate away); rendering via a main-process `WebContentsView` (diverges from
the established `<webview>` pattern, reuses none of the existing machinery).

## Architecture

### Main process — `src/main/code-server/`

Structured behind an interface so a future remote provider can slot in.

- **`code-server-paths.ts`** — cache + executable resolution.
  - Cache root: `join(app.getPath('userData'), 'code-server')`.
  - Candidate-list resolver (house style, mirrors `computer/macos-native-provider-paths.ts`):
    `ORCA_CODE_SERVER_PATH` env → `<cache>/lib/code-server-<version>/bin/code-server`
    → `<cache>/bin/code-server`; `candidates.find(existsSync)`.

- **`code-server-installer.ts`** — ensure-installed (mirrors `speech/model-manager.ts`).
  - Runs code-server's official `install.sh` — a **pinned copy vendored in `extraResources`**
    (not `curl | sh` at runtime; pins the installer logic, only the release archive is fetched) —
    as `sh install.sh --method standalone --prefix <cache> --version <PINNED_VERSION>`.
    Standalone bundles its own Node, so there is no system-Node dependency.
  - Idempotent: skip if the pinned-version executable already resolves.
  - macOS: strip `com.apple.quarantine` from the extracted tree post-install.
  - Missing prereqs (`sh`/`curl`/`tar`) or unsupported arch → structured error surfaced to the
    pane; clean up partial cache on failure. `PINNED_VERSION` is a constant, bumped manually via PR.

- **`code-server-manager.ts`** — supervises **one shared** server process.
  - `ensureRunning()`: `ensureInstalled()` → pick a free `127.0.0.1` port (reuse `src/main/ports/`)
    → spawn → wait for readiness (poll `http://127.0.0.1:<port>/healthz`) → return `{ port }`.
  - Launch args: `--bind-addr 127.0.0.1:<port> --auth none --disable-telemetry
    --user-data-dir <cache>/user-data --extensions-dir <cache>/extensions`. The user-data and
    extensions dirs are isolated in Orca's cache; the user's VS Code **settings** are reused via
    symlinks (see "VS Code settings reuse"), while extensions stay code-server-managed.
  - **Non-detached child tied to Orca's lifetime**: killed on app `will-quit`; auto-restarted if
    the server itself crashes; stale process reaped on startup via a pidfile in the cache dir.
  - Status state machine: `not-installed → installing → starting → ready → error`, plus `stopped`.
    Stopped when the last VSCode tab closes and on app quit.

- **`code-server-service.ts`** — lazy singleton + orchestration hook (mirrors
  `speech/speech-runtime-service.ts`), started on the first VSCode tab.

- **IPC** (`src/main/ipc/`): `codeServer:ensureRunning`, `codeServer:getStatus` (invoke) +
  a `codeServer:statusChanged` event (installing progress, ready, error). Typed
  `window.api.codeServer.*` in `src/preload/api-types.ts` + bridged in `src/preload/index.ts`.

### Renderer

- **Data model** (`src/shared/types.ts`): add `'vscode'` to `TabContentType` and
  `WorkspaceVisibleTabType`. New flat type (VS Code has no sub-pages, unlike the browser's
  workspace→pages hierarchy):

  ```ts
  export type CodeServerTab = {
    id: string
    worktreeId: string
    folderPath: string // the worktree working directory, opened via ?folder=
    label: string
  }
  ```

  Persisted in `WorkspaceSessionState` as `codeServerTabsByWorktree` and
  `activeCodeServerTabIdByWorktree`.

- **Store slice** (`src/renderer/src/store/slices/code-server.ts`): `codeServerTabsByWorktree`,
  `activeCodeServerTabIdByWorktree`, plus a server-status mirror (`codeServerStatus`,
  `codeServerPort`) fed by `codeServer:statusChanged`. Actions `createCodeServerTab(worktreeId)`,
  `closeCodeServerTab(id)`, `setActiveCodeServerTab`. Integrates with the unified tabs /
  tab-groups the same way `createBrowserTab` does (via `openTabBarEntry`), so a VSCode tab
  behaves like any other tab (split, reorder, MRU, persistence).
  - **One VSCode tab per worktree**: `createCodeServerTab` focuses the existing tab if one is
    already open for that worktree (avoids same-folder window contention on the shared server).

- **Rendering** — `CodeServerPane.tsx` + `code-server-webview.ts`.
  - `code-server-webview.ts` mirrors `browser-pane/browser-page-webview.ts` (webview creation +
    registry + a dedicated partition `persist:orca-vscode` shared across all VSCode tabs — same
    origin, `--auth none`, so one session is correct) but stripped down: no address bar / nav /
    favicon / title listeners; only `dom-ready` and `did-fail-load` drive the ready/error states.
    Its own guest web-preferences constant, based on the browser's.
  - On mount the pane calls `window.api.codeServer.ensureRunning()`, which **auto-starts** the
    install/download on first use. Status-driven UI: `installing` (progress + cancel),
    `starting` (spinner), `error` (message + Retry + manual-install link), `ready` (editor).
  - Once ready: `webview.src = http://127.0.0.1:<port>/?folder=<encodeURIComponent(folderPath)>`.
    Always `?folder=` — `.code-workspace` files are ignored in v1.
  - Styling per `docs/STYLEGUIDE.md`: pane recedes; loading/error states use `muted`/
    `editor-surface` tokens; no invented colors.

- **Tab chip** — `CodeServerTab.tsx`, modeled on `tab-bar/BrowserTab.tsx`, with a **generic code
  glyph** (lucide `Code`/`SquareCode`, not the VS Code logo) and the worktree-derived label.

### Entry point & gating

- **Menu option** (`src/renderer/src/components/tab-bar/tab-create-menu-options.ts`): add
  `'new-vscode'` to `TabCreateMenuOptionKind` and a **"New VSCode Tab"** option gated on a new
  `context.hasNewVSCode` (mirrors the `hasNewBrowser` block).
- **Context assembly** (`src/renderer/src/components/tab-bar/TabBar.tsx`, `TabBarInner`, near the
  existing `createMenuOptions` `useMemo`): `hasNewVSCode` is true iff
  `getExecutionHostIdForWorktree(state, worktreeId) === LOCAL_EXECUTION_HOST_ID`
  (from `@/lib/worktree-runtime-owner` + `shared/execution-host` — stricter than the browser
  code's runtime-only check; correctly excludes SSH) **and** `getRendererAppPlatform()` is
  `'darwin'` or `'linux'` (from `@/lib/renderer-app-platform`).
  - Windows: option hidden. Remote worktree (mac/linux): option shown **disabled with a tooltip**
    ("VSCode isn't available for remote workspaces yet").
- **Handlers**: `TabBar.tsx` `case 'new-vscode'` → `onNewVSCodeTab()` (new prop alongside
  `onNewBrowserTab`); `Terminal.tsx` `handleNewVSCodeTab` resolves
  `activeWorktreeId → getKnownWorktreeById().path`, re-checks the local/platform guard, then calls
  `createCodeServerTab(worktreeId)`.

## Keyboard shortcuts — VSCode owns the keyboard

**Requirement:** when the VSCode tab is focused, keystrokes belong to VSCode
(`Cmd+D` = select next occurrence, not open a terminal).

This is satisfied by the webview-guest model, not by special-casing:

- A `<webview>` guest is a separate Chromium process. Keystrokes typed inside it **never reach**
  Orca's renderer `keydown` handler (`App.tsx`) or the main-process `before-input-event`
  (`createMainWindow.ts`). Orca only "steals back" a curated set of chords from a focused guest
  via the opt-in `setupGuestShortcutForwarding` allowlist (applied to the *browser* guest in
  `browser-manager.ts` / `browser-guest-ui.ts`).
- There is exactly one native menu accelerator in the app — `Cmd/Ctrl+V` (Paste,
  `menu/register-app-menu.ts`) — which an editor wants anyway. Every other Orca chord resolves
  via `before-input-event`, which does not fire for a focused guest.

**Design:** register the VSCode guest through the same attach/register path as the browser
(`will-attach-webview`/`did-attach-webview` → renderer `registerGuest` on `dom-ready`), but
**do not apply `setupGuestShortcutForwarding` to the VSCode guest** (empty forwarding allowlist).
The registration path distinguishes a VSCode guest from a browser guest so no chords are
forwarded. Result: every chord (`Cmd+D`, `Cmd+K` chords, `Cmd+W`, `Cmd+T`, `Ctrl+C`, arrows,
`Cmd+1..9`, …) reaches code-server. To return to Orca chrome, the user clicks another tab or uses
OS-level window switching — matching how a real VS Code window behaves.

## VS Code settings reuse

The embedded editor reuses the user's existing VS Code **settings** (not extensions) via
symlinks, so themes/fonts/keybindings/formatting carry over with a single source of truth.

- **Module** `code-server-vscode-settings-link.ts` (invoked by the installer/manager before first
  launch, idempotent):
  1. Resolve the real VS Code **User** dir per-OS: macOS
     `~/Library/Application Support/Code/User/`, Linux `~/.config/Code/User/`. v1 targets stable
     "Code" only (Insiders / VSCodium are follow-ups).
  2. Ensure `<cache>/user-data/User/` exists.
  3. For each of `settings.json`, `keybindings.json`, and the `snippets/` directory: if the real
     target exists and the code-server-side path is not already a correct symlink to it, (re)create
     a **symlink** from `<cache>/user-data/User/<name>` → the real path. Edits made inside embedded
     VS Code therefore write back to the user's real config (intended — single source of truth).
  4. If a real target does not exist (user has no VS Code, or hasn't set that file), **skip it** —
     never create a dangling symlink; code-server falls back to defaults.
  5. If symlink creation fails (permissions, pre-existing real file on the code-server side),
     log and continue with an isolated/empty file — never block the editor from opening.
- **Extensions are code-server-managed, persistent, and shared across all workspaces.** The
  `--extensions-dir <cache>/extensions` and `--user-data-dir <cache>/user-data` live under
  `app.getPath('userData')`, so extensions installed inside embedded VS Code **persist across Orca
  restarts** (the manager reuses the same dirs on relaunch — the cache is never cleared on stop).
  Because there is one shared server with one extensions dir, extensions install once and are
  **available in every Orca workspace/worktree**, like a normal VS Code install.
- **The user's real VS Code extensions are not reused** — Microsoft-marketplace extensions are
  licensed for MS products and generally incompatible with Code-OSS/code-server, and pointing at
  the real extensions dir risks version/state conflicts. code-server manages its own extensions
  via Open VSX.

## Auth & security

`--auth none` bound to `127.0.0.1` only; code-server validates the `Host` header, so a web page
cannot reach the loopback port. Accepted tradeoff: on a shared multi-user machine another logged-in
user could reach the port and get a terminal as the current user. On a single-user dev machine this
is not a new trust boundary. Documented as a v1 limitation.

## Error handling & edge cases

- **Install failure** (offline, missing `curl`/`tar`, unsupported arch): `error` state in the
  pane with reason + Retry + manual-install link; no crash; partial cache cleaned up.
- **Server crash**: manager auto-restarts; pane shows reconnecting and reloads the webview once
  `ready` returns.
- **Port conflict**: re-pick a free port on restart.
- **Lifecycle**: shared server up while ≥1 VSCode tab is open (any worktree); stopped when the last
  closes and on app quit (registered in app-quit teardown); orphan reaped on next startup.
- **macOS quarantine** stripped post-install so the bundled Node/binary runs.
- **Same folder twice**: prevented by the one-tab-per-worktree rule.

## Cross-platform

macOS + Linux (amd64/arm64) only in v1. Windows: feature hidden. All paths via `path.join` /
Electron path utilities. The macOS non-ASCII userData path issue does not apply (Windows out of scope).

## Known limitations (v1, documented)

- Extensions come from **Open VSX** (Microsoft marketplace off-limits by ToS) and are **not**
  reused from the user's real VS Code — only settings are (see "VS Code settings reuse").
- Single shared server is a **single point of failure** (mitigated by auto-restart).
- No keyboard escape from a focused editor back to Orca chrome (by design — editor owns the
  keyboard); use the mouse to switch tabs.

## Validation before locking in

- **Multi-folder concurrency spike**: confirm a single code-server instance cleanly serves
  multiple different `?folder=` sessions concurrently (independent workbenches/extension hosts).
  If it does not, fall back to one process per worktree — isolated behind the manager interface,
  so only `code-server-manager.ts` changes.

## Testing

- **Unit (main):** path/candidate resolver; install idempotency check; launch-arg construction;
  readiness state machine; free-port selection; pidfile orphan reap; settings-link seeding
  (per-OS User-dir resolution, idempotent symlink creation, skip-when-missing, failure fallback).
- **Unit (renderer):** slice reducers (create/close/active + one-tab-per-worktree focus);
  menu-option gating across platform × local/remote; `?folder=` URL construction with path encoding.
- **Integration:** installer against a mocked `install.sh` (asserts flags/prefix); the real network
  download is gated behind an opt-in manual test. Follows the `speech`/`browser` module test layout.

## Key integration points (reference)

- Webview/guest: `browser-pane/browser-page-webview.ts`, `BrowserPane.tsx` (`registerGuest` on
  `dom-ready`), `main/browser/browser-manager.ts` (`attachGuestPolicies`, `registerGuest`,
  `setupShortcutForwarding` — omitted for VSCode), `main/browser/browser-guest-ui.ts`.
- Guest attach: `main/window/createMainWindow.ts` (`will-attach-webview`/`did-attach-webview`).
- Gating: `lib/worktree-runtime-owner.ts` (`getExecutionHostIdForWorktree`),
  `shared/execution-host.ts` (`LOCAL_EXECUTION_HOST_ID`), `lib/renderer-app-platform.ts`
  (`getRendererAppPlatform`), `tab-bar/tab-create-menu-options.ts`, `tab-bar/TabBar.tsx`,
  `components/Terminal.tsx` (`handleNewBrowserTab` precedent).
- Acquisition/lifecycle precedents: `main/speech/model-manager.ts` (download/verify/extract/cache),
  `main/emulator/serve-sim-*` (workspace-scoped server process), `main/ports/` (free-port + advertised URLs).
- Packaging: `config/electron-builder.config.cjs` (`extraResources` for the vendored `install.sh`).
