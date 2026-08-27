import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { LspServerId } from '../../../../shared/lsp-types'
import { LSP_PROJECT_SERVER_OVERRIDES } from '../../../../shared/lsp-language-support'

const angularRootCache = new Map<string, Promise<boolean>>()

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
export function isAngularProjectRoot(rootPath: string): Promise<boolean> {
  let cached = angularRootCache.get(rootPath)
  if (!cached) {
    cached = detectAngularProject(rootPath)
    angularRootCache.set(rootPath, cached)
  }
  return cached
}

/** Swap the base server for its project-conditional override (Angular templates
 *  are plain .html files) unless the user disabled the override server. */
export async function resolveLspProjectServerOverride(
  settings: GlobalSettings | null,
  baseServerId: LspServerId,
  rootPath: string
): Promise<LspServerId> {
  const overrideId = LSP_PROJECT_SERVER_OVERRIDES[baseServerId]
  if (!overrideId || settings?.lspDisabledServers?.includes(overrideId)) {
    return baseServerId
  }
  return (await isAngularProjectRoot(rootPath)) ? overrideId : baseServerId
}
