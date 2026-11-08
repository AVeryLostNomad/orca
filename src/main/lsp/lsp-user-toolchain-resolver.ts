import { spawnProcess } from '@orca/process-host'
import { existsSync, mkdirSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { hydrateShellPath } from '../startup/hydrate-shell-path'
import { lspRootDir } from './lsp-install-paths'

export type GoplsResolution =
  | { kind: 'found'; command: string; env: NodeJS.ProcessEnv }
  | { kind: 'toolchain-missing' }
  | { kind: 'install-failed'; message: string }

function goplsCacheBinDir(): string {
  return join(lspRootDir(), 'servers', 'gopls', 'bin')
}

function goplsBinaryName(): string {
  return process.platform === 'win32' ? 'gopls.exe' : 'gopls'
}

export async function hydratedToolchainEnv(): Promise<NodeJS.ProcessEnv> {
  const hydration = await hydrateShellPath()
  const env = { ...process.env }
  if (hydration.ok && hydration.segments.length > 0) {
    // A spread loses Windows' case-insensitive `Path`; write back to the real key.
    const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH'
    const current = env[pathKey] ?? ''
    env[pathKey] = [...hydration.segments, ...current.split(delimiter).filter(Boolean)].join(
      delimiter
    )
  }
  return env
}

export function runToolchainCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawnProcess({
      program: command,
      args,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let output = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-4096)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-4096)
    })
    child.on('error', () => resolve({ ok: false, output }))
    child.on('exit', (code) => resolve({ ok: code === 0, output }))
  })
}

let inFlight: Promise<GoplsResolution> | null = null

/** gopls ships no prebuilt binaries: use the user's copy from PATH, else
 *  `go install` one into Orca's cache using the user's Go toolchain. */
export function resolveOrInstallGopls(): Promise<GoplsResolution> {
  inFlight ??= resolve().finally(() => {
    inFlight = null
  })
  return inFlight
}

async function resolve(): Promise<GoplsResolution> {
  const env = await hydratedToolchainEnv()

  const cached = join(goplsCacheBinDir(), goplsBinaryName())
  if (existsSync(cached)) {
    return { kind: 'found', command: cached, env }
  }

  if ((await runToolchainCommand(goplsBinaryName(), ['version'], env)).ok) {
    return { kind: 'found', command: goplsBinaryName(), env }
  }

  const goProbe = await runToolchainCommand('go', ['version'], env)
  if (!goProbe.ok) {
    return { kind: 'toolchain-missing' }
  }
  mkdirSync(goplsCacheBinDir(), { recursive: true })
  const installEnv = { ...env, GOBIN: goplsCacheBinDir() }
  const install = await runToolchainCommand(
    'go',
    ['install', 'golang.org/x/tools/gopls@latest'],
    installEnv
  )
  if (!install.ok) {
    return { kind: 'install-failed', message: install.output.trim().slice(-1024) }
  }
  if (!existsSync(cached)) {
    return { kind: 'install-failed', message: 'go install completed but gopls binary is missing' }
  }
  return { kind: 'found', command: cached, env }
}
