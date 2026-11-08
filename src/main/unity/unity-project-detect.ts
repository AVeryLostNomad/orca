import type { Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

const SKIPPED_SCAN_DIRS: Record<string, true> = {
  node_modules: true,
  Library: true,
  Temp: true,
  Logs: true,
  obj: true,
  Build: true,
  Builds: true
}

async function statKind(path: string): Promise<'file' | 'dir' | null> {
  try {
    const info = await stat(path)
    return info.isDirectory() ? 'dir' : info.isFile() ? 'file' : null
  } catch {
    return null
  }
}

export async function isUnityProjectRoot(dir: string): Promise<boolean> {
  const [version, assets] = await Promise.all([
    statKind(join(dir, 'ProjectSettings', 'ProjectVersion.txt')),
    statKind(join(dir, 'Assets'))
  ])
  return version === 'file' && assets === 'dir'
}

/** Nearest ancestor (inclusive) of `path` that is a Unity project root, never
 *  walking above `stopAt` when given. */
export async function findUnityProjectRootFor(
  path: string,
  stopAt?: string
): Promise<string | null> {
  const boundary = stopAt ? resolve(stopAt).toLowerCase() : null
  let current = resolve(path)
  if ((await statKind(current)) !== 'dir') {
    current = dirname(current)
  }
  for (;;) {
    if (await isUnityProjectRoot(current)) {
      return current
    }
    const parent = dirname(current)
    if (current.toLowerCase() === boundary || parent === current) {
      return null
    }
    current = parent
  }
}

/** Unity project roots at or below `root` (bounded depth; Unity projects nest
 *  under a repo root in monorepos, but never inside Library/Temp/etc). */
export async function findUnityProjectRootsUnder(root: string, maxDepth = 2): Promise<string[]> {
  const found: string[] = []
  const visit = async (dir: string, depth: number): Promise<void> => {
    if (await isUnityProjectRoot(dir)) {
      found.push(dir)
      return
    }
    if (depth >= maxDepth) {
      return
    }
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isDirectory() && !entry.name.startsWith('.') && !SKIPPED_SCAN_DIRS[entry.name]
        )
        .map((entry) => visit(join(dir, entry.name), depth + 1))
    )
  }
  await visit(resolve(root), 0)
  return found.sort()
}
