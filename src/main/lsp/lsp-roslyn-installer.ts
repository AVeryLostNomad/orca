import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { LspInstallError } from './lsp-artifact-download'
import { lspServerInstallDir } from './lsp-install-paths'
import { ensurePinnedArchiveInstalled } from './lsp-pinned-archive-installer'
import roslynConfig from '../../../config/lsp-roslyn.json'

type RoslynAssetPin = { url: string; sha256: string; serverRelativePath: string }

export const ROSLYN_VERSION: string = roslynConfig.roslyn.version

const UNITY_ANALYZERS = roslynConfig.unityAnalyzers

export function roslynAssetForCurrentPlatform(): RoslynAssetPin | undefined {
  const assets: Record<string, RoslynAssetPin | undefined> = roslynConfig.roslyn.assets
  return assets[`${process.platform}-${process.arch}`]
}

function roslynInstallRoot(): string {
  return lspServerInstallDir('csharp', ROSLYN_VERSION)
}

function unityAnalyzersInstallRoot(): string {
  return lspServerInstallDir('unity-analyzers', UNITY_ANALYZERS.version)
}

/** Microsoft.Unity.Analyzers.dll when installed (it ships with the C# server). */
export function resolveInstalledUnityAnalyzers(): string | null {
  const dll = join(unityAnalyzersInstallRoot(), ...UNITY_ANALYZERS.analyzerRelativePath.split('/'))
  return existsSync(dll) ? dll : null
}

export function resolveInstalledRoslyn(): string | null {
  const asset = roslynAssetForCurrentPlatform()
  if (!asset || !resolveInstalledUnityAnalyzers()) {
    return null
  }
  const dll = join(roslynInstallRoot(), ...asset.serverRelativePath.split('/'))
  return existsSync(dll) ? dll : null
}

/** Install the pinned Roslyn server package plus Microsoft.Unity.Analyzers;
 *  returns the server dll (run with `dotnet <dll>`). Nupkgs are zips. */
export async function ensureRoslynInstalled(
  onProgress: (fraction: number) => void
): Promise<string> {
  const asset = roslynAssetForCurrentPlatform()
  if (!asset) {
    throw new LspInstallError(
      `no pinned C# language server for ${process.platform}-${process.arch} (config/lsp-roslyn.json)`
    )
  }
  const serverDll = await ensurePinnedArchiveInstalled(
    {
      key: 'csharp',
      url: asset.url,
      hash: { algorithm: 'sha256', digest: asset.sha256 },
      archive: 'zip',
      payloadRelativePath: asset.serverRelativePath,
      executable: false,
      installRoot: roslynInstallRoot()
    },
    (fraction) => onProgress(fraction * 0.97)
  )
  await ensurePinnedArchiveInstalled(
    {
      key: 'unity-analyzers',
      url: UNITY_ANALYZERS.url,
      hash: { algorithm: 'sha256', digest: UNITY_ANALYZERS.sha256 },
      archive: 'zip',
      payloadRelativePath: UNITY_ANALYZERS.analyzerRelativePath,
      executable: false,
      installRoot: unityAnalyzersInstallRoot()
    },
    (fraction) => onProgress(0.97 + fraction * 0.03)
  )
  return serverDll
}
