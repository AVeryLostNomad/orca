import { existsSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { LspInstallError } from './lsp-artifact-download'
import { lspServerInstallDir } from './lsp-install-paths'
import { ensurePinnedArchiveInstalled } from './lsp-pinned-archive-installer'
import { hydratedToolchainEnv, runToolchainCommand } from './lsp-user-toolchain-resolver'
import roslynConfig from '../../../config/lsp-roslyn.json'

type DotnetSdkAssetPin = { url: string; sha512: string; archive: string }

type LspDotnetRuntime = {
  /** Absolute path of the dotnet host executable. */
  command: string
  env: NodeJS.ProcessEnv
}

// Roslyn's runtimeconfig targets net10.0 (rollForward Major).
const MIN_RUNTIME_MAJOR = 10

const DOTNET_ENV = {
  DOTNET_CLI_TELEMETRY_OPTOUT: '1',
  DOTNET_NOLOGO: '1',
  DOTNET_MULTILEVEL_LOOKUP: '0',
  DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1'
} as const

function dotnetExecutableName(): string {
  return process.platform === 'win32' ? 'dotnet.exe' : 'dotnet'
}

function privateSdkRoot(): string {
  return lspServerInstallDir('dotnet-sdk', roslynConfig.dotnetSdk.version)
}

function runtimeFor(root: string, baseEnv: NodeJS.ProcessEnv): LspDotnetRuntime {
  const env: NodeJS.ProcessEnv = { ...baseEnv, ...DOTNET_ENV, DOTNET_ROOT: root }
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH'
  env[pathKey] = [root, ...(env[pathKey] ?? '').split(delimiter).filter(Boolean)].join(delimiter)
  return { command: join(root, dotnetExecutableName()), env }
}

/** Root of the user's dotnet when it can host Roslyn (runtime >= 10) and load
 *  projects (at least one SDK, for MSBuild); null otherwise. */
async function probeUserDotnetRoot(env: NodeJS.ProcessEnv): Promise<string | null> {
  const probeEnv = { ...env, ...DOTNET_ENV }
  const runtimes = await runToolchainCommand('dotnet', ['--list-runtimes'], probeEnv)
  if (!runtimes.ok) {
    return null
  }
  let root: string | null = null
  for (const match of runtimes.output.matchAll(
    /^Microsoft\.NETCore\.App (\d+)\.\S+ \[(.+)\]\s*$/gm
  )) {
    if (Number(match[1]) >= MIN_RUNTIME_MAJOR) {
      // Listed path is <root>/shared/Microsoft.NETCore.App.
      root = dirname(dirname(match[2]))
      break
    }
  }
  if (!root || !existsSync(join(root, dotnetExecutableName()))) {
    return null
  }
  const sdks = await runToolchainCommand(
    join(root, dotnetExecutableName()),
    ['--list-sdks'],
    probeEnv
  )
  return sdks.ok && /^\d+\.\d+\.\d+/m.test(sdks.output) ? root : null
}

let resolved: LspDotnetRuntime | null = null
let inFlight: Promise<LspDotnetRuntime> | null = null

/** A dotnet able to run Roslyn and MSBuild: Orca's private SDK if already
 *  installed, else the user's qualifying dotnet, else install the pinned SDK. */
export function resolveLspDotnet(
  onProgress: (fraction: number) => void
): Promise<LspDotnetRuntime> {
  if (resolved && existsSync(resolved.command)) {
    return Promise.resolve(resolved)
  }
  inFlight ??= resolveUncached(onProgress)
    .then((runtime) => {
      resolved = runtime
      return runtime
    })
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

async function resolveUncached(onProgress: (fraction: number) => void): Promise<LspDotnetRuntime> {
  const env = await hydratedToolchainEnv()
  if (existsSync(join(privateSdkRoot(), dotnetExecutableName()))) {
    return runtimeFor(privateSdkRoot(), env)
  }
  const userRoot = await probeUserDotnetRoot(env)
  if (userRoot) {
    return runtimeFor(userRoot, env)
  }
  const platform = `${process.platform}-${process.arch}`
  const assets: Record<string, DotnetSdkAssetPin | undefined> = roslynConfig.dotnetSdk.assets
  const asset = assets[platform]
  if (!asset) {
    throw new LspInstallError(
      `C# support needs a .NET ${MIN_RUNTIME_MAJOR} SDK; none is pinned for ${platform}`
    )
  }
  await ensurePinnedArchiveInstalled(
    {
      key: 'dotnet-sdk',
      url: asset.url,
      hash: { algorithm: 'sha512', digest: asset.sha512 },
      archive: asset.archive === 'zip' ? 'zip' : 'tar.gz',
      payloadRelativePath: dotnetExecutableName(),
      executable: true,
      installRoot: privateSdkRoot()
    },
    onProgress
  )
  return runtimeFor(privateSdkRoot(), env)
}
