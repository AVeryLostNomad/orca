import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { UnityEditorPackageResult } from '../../shared/unity-types'
import { getAppEnvironment } from '../../shared/app-environment'
import { getBundledLauncherPath } from '../cli/bundled-cli-launcher-path'
import { DEV_COMMAND_NAME } from '../cli/cli-install-constants'
import { NOT_A_PROJECT_ERROR, isLocalUnityProject, runEditorCommand } from './unity-editor-bridge'
import { readPipelineEndpoint } from './unity-pipeline-http'

export const UNITY_EDITOR_PACKAGE_NAME = 'com.stablyai.orca.ide'

/** Library/Orca/orca-editor.json, read by the package to find and select this Orca. */
type OrcaEditorConfig = {
  appPath: string
  cliPath: string | null
  version: string
  autoSelect: boolean
}

function bundledPackageDir(): string | null {
  const app = getAppEnvironment()
  const relative = join('unity', UNITY_EDITOR_PACKAGE_NAME)
  const candidates = app.isPackaged()
    ? [join(process.resourcesPath, relative)]
    : [
        join(app.getAppPath(), 'resources', relative),
        // electron-vite dev and E2E runs set the app path to out/main.
        join(app.getAppPath(), '..', '..', 'resources', relative),
        join(process.cwd(), 'resources', relative)
      ]
  return candidates.find((candidate) => existsSync(join(candidate, 'package.json'))) ?? null
}

async function packageVersion(packageDir: string): Promise<string | null> {
  try {
    const manifest: unknown = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'))
    const version =
      manifest && typeof manifest === 'object' && 'version' in manifest ? manifest.version : null
    return typeof version === 'string' ? version : null
  } catch {
    return null
  }
}

/** Semver precedence for `major.minor.patch[-prerelease]`; a release outranks its prereleases. */
export function compareUnityPackageVersions(a: string, b: string): number {
  const [aCore, aPre] = a.split('-', 2)
  const [bCore, bPre] = b.split('-', 2)
  const aParts = aCore.split('.').map(Number)
  const bParts = bCore.split('.').map(Number)
  for (let index = 0; index < Math.max(aParts.length, bParts.length); index++) {
    const difference = (aParts[index] || 0) - (bParts[index] || 0)
    if (difference !== 0) {
      return Math.sign(difference)
    }
  }
  if (aPre === bPre) {
    return 0
  }
  if (aPre === undefined || bPre === undefined) {
    return aPre === undefined ? 1 : -1
  }
  return aPre.localeCompare(bPre, undefined, { numeric: true }) < 0 ? -1 : 1
}

/** The executable Unity stores as External Script Editor, plus the CLI the package drives. */
function orcaEditorConfig(): OrcaEditorConfig | null {
  const app = getAppEnvironment()
  if (app.isPackaged()) {
    const cliPath = getBundledLauncherPath(process.platform, process.resourcesPath)
    // macOS stores the .app bundle, not Contents/MacOS/Orca.
    const appPath =
      process.platform === 'darwin' ? dirname(dirname(dirname(process.execPath))) : process.execPath
    return { appPath, cliPath, version: app.getVersion(), autoSelect: true }
  }
  // Dev builds run inside a shared electron binary, so the dev CLI launcher is the identity.
  const devCli = join(
    app.getPath('userData'),
    'cli',
    'bin',
    process.platform === 'win32' ? `${DEV_COMMAND_NAME}.cmd` : DEV_COMMAND_NAME
  )
  return existsSync(devCli)
    ? { appPath: devCli, cliPath: devCli, version: app.getVersion(), autoSelect: true }
    : null
}

async function writeIfChanged(path: string, content: string): Promise<void> {
  const current = await readFile(path, 'utf8').catch(() => null)
  if (current !== content) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content, 'utf8')
  }
}

/**
 * Copies Orca's Unity editor package into Packages/ when it is missing or older than the bundled
 * copy (never downgrading, so a newer or locally edited copy stays), then points it at this Orca.
 */
export async function ensureUnityEditorPackage(
  projectRoot: string
): Promise<UnityEditorPackageResult> {
  if (!(await isLocalUnityProject(projectRoot))) {
    return { ok: false, error: NOT_A_PROJECT_ERROR }
  }
  const source = bundledPackageDir()
  const bundledVersion = source ? await packageVersion(source) : null
  if (!source || !bundledVersion) {
    return { ok: false, error: 'This Orca install is missing its Unity editor package.' }
  }
  const config = orcaEditorConfig()
  if (!config) {
    return {
      ok: false,
      error: 'Install the Orca command-line tool (Settings > CLI) so Unity can open files in Orca.'
    }
  }
  const packagePath = join(projectRoot, 'Packages', UNITY_EDITOR_PACKAGE_NAME)
  try {
    const installedVersion = await packageVersion(packagePath)
    const outcome =
      installedVersion === null
        ? 'installed'
        : compareUnityPackageVersions(bundledVersion, installedVersion) > 0
          ? 'updated'
          : 'current'
    await writeIfChanged(
      join(projectRoot, 'Library', 'Orca', 'orca-editor.json'),
      `${JSON.stringify(config, null, 2)}\n`
    )
    if (outcome !== 'current') {
      await rm(packagePath, { recursive: true, force: true })
      await cp(source, packagePath, { recursive: true })
      // A background editor resolves new embedded packages only on focus; resolve now when Pipeline can.
      if (await readPipelineEndpoint(projectRoot)) {
        await runEditorCommand(projectRoot, 'package resolve', {}, 60_000)
      }
    }
    return {
      ok: true,
      outcome,
      version: outcome === 'current' && installedVersion ? installedVersion : bundledVersion,
      packagePath
    }
  } catch (error) {
    return {
      ok: false,
      error: `Could not install Orca's Unity package: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}
