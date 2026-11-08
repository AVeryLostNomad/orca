import { readdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type { UnityProjectInfo } from '../../shared/unity-types'
import { findUnityProjectRootFor } from './unity-project-detect'
import {
  parseBuildSettingsScenes,
  parseInputManagerAxes,
  parsePipelinePackage,
  parseProjectVersion,
  parseTagManager
} from './unity-project-settings-parser'

const SOURCE_FILES = {
  version: ['ProjectSettings', 'ProjectVersion.txt'],
  tagManager: ['ProjectSettings', 'TagManager.asset'],
  buildSettings: ['ProjectSettings', 'EditorBuildSettings.asset'],
  inputManager: ['ProjectSettings', 'InputManager.asset'],
  manifest: ['Packages', 'manifest.json']
} as const

type CachedInfo = { fingerprint: string; info: UnityProjectInfo }

const cache = new Map<string, CachedInfo>()

async function mtimeOf(path: string): Promise<number> {
  try {
    return (await stat(path)).mtimeMs
  } catch {
    return -1
  }
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

/** Source mtimes plus the root dir mtime, which moves when .sln/.csproj files appear or vanish. */
async function fingerprintOf(projectRoot: string): Promise<string> {
  const paths = [
    projectRoot,
    ...Object.values(SOURCE_FILES).map((parts) => join(projectRoot, ...parts))
  ]
  return (await Promise.all(paths.map(mtimeOf))).join('|')
}

async function loadProjectInfo(projectRoot: string): Promise<UnityProjectInfo> {
  const [version, tagManager, buildSettings, inputManager, manifest, entries] = await Promise.all([
    readOptional(join(projectRoot, ...SOURCE_FILES.version)),
    readOptional(join(projectRoot, ...SOURCE_FILES.tagManager)),
    readOptional(join(projectRoot, ...SOURCE_FILES.buildSettings)),
    readOptional(join(projectRoot, ...SOURCE_FILES.inputManager)),
    readOptional(join(projectRoot, ...SOURCE_FILES.manifest)),
    readdir(projectRoot, { withFileTypes: true }).catch(() => [])
  ])
  const rootFiles = entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
  return {
    projectRoot,
    editorVersion: version === null ? null : parseProjectVersion(version),
    ...parseTagManager(tagManager),
    scenes: parseBuildSettingsScenes(buildSettings),
    inputAxes: parseInputManagerAxes(inputManager),
    solutionFiles: rootFiles
      .filter((name) => /\.slnx?$/i.test(name))
      .sort()
      .map((name) => join(projectRoot, name)),
    hasProjectFiles: rootFiles.some((name) => /\.csproj$/i.test(name)),
    pipelinePackage: parsePipelinePackage(manifest)
  }
}

export async function getUnityProjectInfoForRoot(projectRoot: string): Promise<UnityProjectInfo> {
  const fingerprint = await fingerprintOf(projectRoot)
  const cached = cache.get(projectRoot)
  if (cached?.fingerprint === fingerprint) {
    return cached.info
  }
  const info = await loadProjectInfo(projectRoot)
  cache.set(projectRoot, { fingerprint, info })
  return info
}

/** Nearest Unity project of a local path; non-absolute (remote-relative) paths are rejected. */
export async function getUnityProjectInfo(path: string): Promise<UnityProjectInfo | null> {
  if (typeof path !== 'string' || !isAbsolute(path)) {
    return null
  }
  const projectRoot = await findUnityProjectRootFor(resolve(path))
  return projectRoot ? getUnityProjectInfoForRoot(projectRoot) : null
}

export function invalidateUnityProjectInfo(projectRoot: string): void {
  cache.delete(projectRoot)
}
