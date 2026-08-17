import { createServer } from 'node:net'
import { mirrorEditorUserConfig } from './code-server-editor-user-config'
import { disableExtensionSignatureVerification } from './code-server-signature-verification'
import { applyCodeServerMachineSettings } from './code-server-machine-settings'
import { setCodeServerPid } from './code-server-process-registry'
import { ensureCodeServerInstalled } from './code-server-installer'
import {
  getCodeServerCacheRoot,
  getCodeServerExtensionsDir,
  getCodeServerPidFilePath,
  getCodeServerUserDataDir,
  resolveCodeServerLaunch
} from './code-server-paths'
import { buildCodeServerArgs } from './code-server-launch-args'

// Everything instance-specific about a workbench server process. The shared
// editor (coder/code-server) and each per-repo Data Studio server (Azure Data
// Studio's web server, built from Microsoft's source) run through the same
// CodeServerManager lifecycle; only the profile differs.
export type CodeServerProfile = {
  key: string // 'editor' | `datastudio:${repoIdHash}`
  userDataDir: string
  extensionsDir: string
  pidFilePath: string
  // Install location this server runs from. On Windows, orphan reaping only
  // tree-kills a pidfile process whose command line references this root.
  installRoot: string
  // Editor: fresh ephemeral port each start. Data Studio: stable per-repo port,
  // because the workbench's client-side storage is keyed to the http origin.
  allocatePort(): Promise<number>
  // Null when the server binary/entry is missing → status 'not-installed' and
  // ensureInstalled runs before the first start.
  resolveInstalled(): string | null
  // Install the server when resolveInstalled() returned null. May report
  // progress (0..1). Throws (with actionable text) when installing is not
  // something Orca can do unattended.
  ensureInstalled(onProgress: (fraction: number) => void): Promise<void>
  // Post-install, pre-spawn steps (config mirroring, machine settings, extension
  // provisioning). Runs on every start.
  prepare(): Promise<void>
  // The concrete process to spawn for a start on `port`. `env` is merged over
  // the manager's hydrated base environment.
  buildSpawn(
    port: number,
    platform: NodeJS.Platform
  ): { command: string; args: string[]; env?: Record<string, string> }
  // HTTP path polled for readiness. coder/code-server exposes /healthz; the
  // upstream VS Code / ADS server has no health endpoint, so '/' is used there.
  readinessProbePath: string
  // Publishes the child pid so the memory collector can attribute the subtree.
  onPidChanged(pid: number | null): void
}

export async function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to allocate a port'))
        return
      }
      const { port } = address
      server.close(() => resolve(port))
    })
  })
}

export function createEditorProfile(): CodeServerProfile {
  return {
    key: 'editor',
    userDataDir: getCodeServerUserDataDir(),
    extensionsDir: getCodeServerExtensionsDir(),
    pidFilePath: getCodeServerPidFilePath(),
    installRoot: getCodeServerCacheRoot(),
    allocatePort: pickFreePort,
    resolveInstalled: () => resolveCodeServerLaunch()?.command ?? null,
    async ensureInstalled(onProgress) {
      await ensureCodeServerInstalled(onProgress)
    },
    async prepare() {
      await mirrorEditorUserConfig()
      // Open VSX + macOS standalone can't verify extension signatures; default
      // the check off for the embedded editor so extension installs work.
      await disableExtensionSignatureVerification()
      // Hide SCM/terminal/chat surfaces via machine-scope settings — Orca owns those.
      await applyCodeServerMachineSettings()
    },
    buildSpawn(port, platform) {
      const launch = resolveCodeServerLaunch()
      if (!launch) {
        throw new Error('code-server is not installed')
      }
      // launch.command is a real executable on every platform (Windows spawns
      // the package's bundled node.exe against entry.js — never a .cmd).
      return {
        command: launch.command,
        args: [...launch.args, ...buildCodeServerArgs(port, platform)]
      }
    },
    readinessProbePath: '/healthz',
    onPidChanged: setCodeServerPid
  }
}
