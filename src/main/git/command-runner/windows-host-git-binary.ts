import { win32 as pathWin32 } from 'node:path'
import { readEnvCaseInsensitive, resolveCommandOnLocalPath } from '../../ipc/command-path-resolver'
import { startSpan, type ActiveSpan } from '../../observability/tracer'

// Why: spawning bare `git` makes libuv walk cwd + every PATH dir with synchronous
// GetFileAttributesW on the main thread; one unreachable network PATH entry froze
// Orca for 5s on ~11% of git spawns. Resolve once off-thread, keyed by PATH.
const resolvedGitBinaryByPath = new Map<string, string>()
const pendingGitBinaryByPath = new Map<string, Promise<string | null>>()
// Why: these are the dirs uv_spawn stats synchronously before reaching git; name the slow ones.
const SLOW_PATH_DIR_MS = 100
const MAX_REPORTED_SLOW_DIRS = 5

function pathKey(env: NodeJS.ProcessEnv): string {
  return readEnvCaseInsensitive(env, 'PATH') ?? ''
}

/** Cached absolute git for this env's PATH, or null when it has not been resolved yet. */
export function peekWindowsHostGitBinary(env: NodeJS.ProcessEnv = process.env): string | null {
  return resolvedGitBinaryByPath.get(pathKey(env)) ?? null
}

export function resolveWindowsHostGitBinary(
  env: NodeJS.ProcessEnv = process.env
): Promise<string | null> {
  const key = pathKey(env)
  const cached = resolvedGitBinaryByPath.get(key)
  if (cached) {
    return Promise.resolve(cached)
  }
  const pending = pendingGitBinaryByPath.get(key)
  if (pending) {
    return pending
  }
  const span = startSpan('git.binary_resolution')
  const searchedDirs: { dir: string; elapsedMs: number }[] = []
  // Why .com/.exe and no cwd: libuv only spawns those extensions, and a repo-planted
  // git.exe in the worktree must never shadow the user's git.
  const resolution = resolveCommandOnLocalPath('git', {
    platform: 'win32',
    env,
    extensions: ['.com', '.exe'],
    searchCwd: false,
    onDirSearched: (dir, elapsedMs) => searchedDirs.push({ dir, elapsedMs })
  })
    .then((match) => {
      const binary = match ? pathWin32.normalize(match) : null
      // Misses stay uncached: bare `git` keeps libuv's own lookup until git appears.
      if (binary) {
        resolvedGitBinaryByPath.set(key, binary)
      }
      endResolutionSpan(span, binary, key, searchedDirs)
      return binary
    })
    .catch((error: unknown) => {
      span.fail(error instanceof Error ? error : new Error(String(error)))
      return null
    })
    .finally(() => {
      pendingGitBinaryByPath.delete(key)
    })
  pendingGitBinaryByPath.set(key, resolution)
  return resolution
}

function endResolutionSpan(
  span: ActiveSpan,
  binary: string | null,
  pathValue: string,
  searchedDirs: { dir: string; elapsedMs: number }[]
): void {
  const slowDirs = searchedDirs
    .filter((entry) => entry.elapsedMs >= SLOW_PATH_DIR_MS)
    .sort((a, b) => b.elapsedMs - a.elapsedMs)
    .slice(0, MAX_REPORTED_SLOW_DIRS)
    .map((entry) => `${Math.round(entry.elapsedMs)}ms ${entry.dir}`)
  span.setAttribute('git.binary_found', binary !== null)
  span.setAttribute('git.binary_dir', binary ? pathWin32.dirname(binary) : '')
  span.setAttribute('path.entry_count', pathValue.split(';').filter(Boolean).length)
  span.setAttribute('path.dirs_searched', searchedDirs.length)
  span.setAttribute('path.slow_dirs', slowDirs.join('; '))
  span.end()
}

export function resetWindowsHostGitBinaryCacheForTests(): void {
  resolvedGitBinaryByPath.clear()
  pendingGitBinaryByPath.clear()
}
