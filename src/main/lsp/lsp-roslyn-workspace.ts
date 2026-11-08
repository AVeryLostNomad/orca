import type { Dirent } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { URI } from 'vscode-uri'
import { findUnityProjectRootFor, findUnityProjectRootsUnder } from '../unity/unity-project-detect'
import type { LspServerHookContext } from './lsp-server-registry'
import { resolveInstalledUnityAnalyzers } from './lsp-roslyn-installer'

const SOLUTION_EXTENSIONS: Record<string, true> = { '.sln': true, '.slnx': true }

const SKIPPED_PROJECT_SCAN_DIRS: Record<string, true> = {
  node_modules: true,
  Library: true,
  Temp: true,
  obj: true,
  bin: true
}

const PROJECT_SCAN_MAX_DEPTH = 4
const PROJECT_SCAN_MAX_DIRS = 2000
const PROJECT_SCAN_MAX_PROJECTS = 200

async function listDir(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

/** The solution directly in `dir`, preferring one named after the folder. */
async function solutionIn(dir: string): Promise<string | null> {
  const solutions = (await listDir(dir))
    .filter((entry) => entry.isFile() && SOLUTION_EXTENSIONS[extname(entry.name).toLowerCase()])
    .map((entry) => entry.name)
    .sort()
  if (solutions.length === 0) {
    return null
  }
  const folderName = basename(dir).toLowerCase()
  const named = solutions.find((name) => basename(name, extname(name)).toLowerCase() === folderName)
  return join(dir, named ?? solutions[0])
}

async function topLevelProjectsIn(dir: string): Promise<string[]> {
  return (await listDir(dir))
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.csproj')
    .map((entry) => join(dir, entry.name))
    .sort()
}

/** Bounded breadth-first *.csproj scan that skips build output and VCS dirs. */
async function scanProjects(root: string): Promise<string[]> {
  const projects: string[] = []
  let frontier = [root]
  let visitedDirs = 0
  for (let depth = 0; depth <= PROJECT_SCAN_MAX_DEPTH && frontier.length > 0; depth++) {
    const next: string[] = []
    for (const dir of frontier) {
      if (++visitedDirs > PROJECT_SCAN_MAX_DIRS) {
        return projects
      }
      for (const entry of await listDir(dir)) {
        if (entry.isDirectory()) {
          if (!entry.name.startsWith('.') && !SKIPPED_PROJECT_SCAN_DIRS[entry.name]) {
            next.push(join(dir, entry.name))
          }
        } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.csproj') {
          projects.push(join(dir, entry.name))
          if (projects.length >= PROJECT_SCAN_MAX_PROJECTS) {
            return projects
          }
        }
      }
    }
    frontier = next
  }
  return projects
}

async function unityProjectRoots(rootPath: string): Promise<string[]> {
  const enclosing = await findUnityProjectRootFor(rootPath)
  return enclosing ? [enclosing] : findUnityProjectRootsUnder(rootPath)
}

/** Roslyn starts only for workspaces inside or containing (depth 2) a Unity project. */
export async function roslynUnityProjectGate(context: {
  rootPath: string
}): Promise<string | null> {
  return (await unityProjectRoots(context.rootPath)).length > 0
    ? null
    : 'C# language support starts only in Unity projects'
}

/** Load Microsoft.Unity.Analyzers (UNT diagnostics + Unity-message suppressors)
 *  only in workspaces that contain a Unity project. */
export async function roslynWorkspaceArgs(context: { rootPath: string }): Promise<string[]> {
  const analyzers = resolveInstalledUnityAnalyzers()
  if (!analyzers || (await unityProjectRoots(context.rootPath)).length === 0) {
    return []
  }
  return ['--extension', analyzers]
}

type RoslynWorkspaceTarget =
  | { kind: 'solution'; path: string }
  | { kind: 'projects'; paths: string[] }

async function findRoslynWorkspaceTarget(rootPath: string): Promise<RoslynWorkspaceTarget | null> {
  const rootSolution = await solutionIn(rootPath)
  if (rootSolution) {
    return { kind: 'solution', path: rootSolution }
  }
  const unityRoots = await unityProjectRoots(rootPath)
  if (unityRoots.length === 1) {
    const unitySolution = await solutionIn(unityRoots[0])
    if (unitySolution) {
      return { kind: 'solution', path: unitySolution }
    }
  }
  // Several Unity projects can't share one solution; load each one's generated csprojs.
  const unityProjects = (await Promise.all(unityRoots.map(topLevelProjectsIn))).flat()
  if (unityProjects.length > 0) {
    return { kind: 'projects', paths: unityProjects }
  }
  const projects = await scanProjects(rootPath)
  return projects.length > 0 ? { kind: 'projects', paths: projects } : null
}

/** Roslyn loads nothing until told which solution/projects to open. */
export async function openRoslynWorkspace(context: LspServerHookContext): Promise<void> {
  const target = await findRoslynWorkspaceTarget(context.rootPath)
  // Roslyn's System.Uri reads `file:///c%3A/...` as the unrooted path `/c:/...`;
  // vscode-csharp sends unencoded URIs for the same reason.
  if (target?.kind === 'solution') {
    context.notify('solution/open', { solution: URI.file(target.path).toString(true) })
  } else if (target?.kind === 'projects') {
    context.notify('project/open', {
      projects: target.paths.map((path) => URI.file(path).toString(true))
    })
  }
}

/** Roslyn asks the client to restore unrestored SDK projects; kick it off and
 *  answer immediately so project loading isn't blocked on the client. */
export function restoreRoslynProjects(params: unknown, context: LspServerHookContext): null {
  const projectFilePaths =
    typeof params === 'object' && params !== null && 'projectFilePaths' in params
      ? params.projectFilePaths
      : undefined
  if (Array.isArray(projectFilePaths) && projectFilePaths.length > 0) {
    context.request('workspace/_roslyn_restore', { projectFilePaths }).catch(() => {
      // Restore failures surface as unresolved references in diagnostics.
    })
  }
  return null
}
