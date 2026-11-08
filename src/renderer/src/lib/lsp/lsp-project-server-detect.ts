import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { LspServerId } from '../../../../shared/lsp-types'
import { LSP_PROJECT_SERVER_OVERRIDES } from '../../../../shared/lsp-language-support'
import { relativePathInsideRoot } from '../../../../shared/cross-platform-path'
import { dirname } from '@/lib/path'

// Matches main's Roslyn session gate (Unity roots at most two levels under the workspace).
const UNITY_PROJECT_MAX_DEPTH = 2

const angularRootCache = new Map<string, Promise<boolean>>()
const unityDirectoryCache = new Map<string, Promise<boolean>>()

async function detectAngularProject(rootPath: string): Promise<boolean> {
  const fs = window.api?.fs
  if (!fs) {
    return false
  }
  try {
    // Forward slash is safe for Node fs on every platform Orca targets.
    if (await fs.pathExists({ filePath: `${rootPath}/angular.json` })) {
      return true
    }
    const packageJson = await fs
      .readFile({ filePath: `${rootPath}/package.json` })
      .catch(() => null)
    if (!packageJson || packageJson.isBinary) {
      return false
    }
    const manifest = JSON.parse(packageJson.content) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    return Boolean(
      manifest.dependencies?.['@angular/core'] ?? manifest.devDependencies?.['@angular/core']
    )
  } catch {
    return false
  }
}

/** True when the local workspace root is an Angular project (cached per root). */
function isAngularProjectRoot(rootPath: string): Promise<boolean> {
  let cached = angularRootCache.get(rootPath)
  if (!cached) {
    cached = detectAngularProject(rootPath)
    angularRootCache.set(rootPath, cached)
  }
  return cached
}

async function detectUnityProjectFile(rootPath: string, filePath: string): Promise<boolean> {
  const project = await window.api?.unity?.getProjectInfo({ path: filePath }).catch(() => null)
  if (!project) {
    return false
  }
  if (relativePathInsideRoot(project.projectRoot, rootPath) !== null) {
    return true
  }
  const projectUnderRoot = relativePathInsideRoot(rootPath, project.projectRoot)
  return (
    projectUnderRoot !== null &&
    projectUnderRoot.split(/[\\/]/).filter(Boolean).length <= UNITY_PROJECT_MAX_DEPTH
  )
}

/** True when `filePath` belongs to a Unity project that is the workspace, encloses
 *  it, or sits shallowly under it (cached per workspace + directory). */
function isUnityProjectFile(rootPath: string, filePath: string): Promise<boolean> {
  const key = `${rootPath}\n${dirname(filePath)}`
  let cached = unityDirectoryCache.get(key)
  if (!cached) {
    cached = detectUnityProjectFile(rootPath, filePath)
    unityDirectoryCache.set(key, cached)
  }
  return cached
}

/** The server a file's project actually gets: Angular templates swap `html` for
 *  the Angular server; C# (Roslyn plus a .NET SDK download) runs only in Unity
 *  projects, so null keeps other C# files on basic highlighting. */
export async function resolveLspProjectServer(
  settings: GlobalSettings | null,
  baseServerId: LspServerId,
  rootPath: string,
  filePath: string
): Promise<LspServerId | null> {
  if (baseServerId === 'csharp') {
    return (await isUnityProjectFile(rootPath, filePath)) ? baseServerId : null
  }
  const overrideId = LSP_PROJECT_SERVER_OVERRIDES[baseServerId]
  if (!overrideId || settings?.lspDisabledServers?.includes(overrideId)) {
    return baseServerId
  }
  return (await isAngularProjectRoot(rootPath)) ? overrideId : baseServerId
}
