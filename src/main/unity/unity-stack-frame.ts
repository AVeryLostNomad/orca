import { stat } from 'node:fs/promises'
import { isAbsolute, join, normalize, sep } from 'node:path'

export type UnityProjectFrame = { file: string; line: number; column?: number }

// Unity managed frames: "(at Assets/Foo.cs:12)"; .NET/NUnit frames: "in C:\p\Foo.cs:12" or ":line 12".
const UNITY_AT_FRAME = /\(at (.+?):(\d+)\)/
const DOTNET_IN_FRAME = / in (.+?\.\w+):(?:line )?(\d+)\s*$/
// Compiler output: "Assets\Scripts\Foo.cs(12,5): error CS0029: ...".
const COMPILER_LOCATION = /^((?:Assets|Packages)[\\/].+?)\((\d+),(\d+)\)/

function isInside(child: string, parent: string): boolean {
  const foldCase = process.platform === 'win32'
  const childKey = foldCase ? child.toLowerCase() : child
  const parentKey = foldCase ? parent.toLowerCase() : parent
  return childKey.startsWith(parentKey.endsWith(sep) ? parentKey : parentKey + sep)
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/** Absolute project-owned file for a frame path, excluding the read-only package cache. */
async function projectOwnedFile(rawPath: string, projectRoot: string): Promise<string | null> {
  const trimmed = rawPath.trim().replace(/^\.[\\/]/, '')
  const absolute = normalize(isAbsolute(trimmed) ? trimmed : join(projectRoot, trimmed))
  if (!isInside(absolute, projectRoot) || isInside(absolute, join(projectRoot, 'Library'))) {
    return null
  }
  // Assets/ always exists on disk; Packages/<name> paths may name registry packages that live in the cache.
  if (isInside(absolute, join(projectRoot, 'Assets'))) {
    return absolute
  }
  return (await isFile(absolute)) ? absolute : null
}

/** First project-owned source location named by a Unity message or stack trace. */
export async function resolveFirstProjectFrame(
  projectRoot: string,
  message: string,
  stackTrace: string
): Promise<UnityProjectFrame | null> {
  const compiler = COMPILER_LOCATION.exec(message.trim())
  if (compiler) {
    const file = await projectOwnedFile(compiler[1], projectRoot)
    if (file) {
      return { file, line: Number(compiler[2]), column: Number(compiler[3]) }
    }
  }
  for (const frame of stackTrace.split(/\r?\n/)) {
    const match = UNITY_AT_FRAME.exec(frame) ?? DOTNET_IN_FRAME.exec(frame)
    if (!match) {
      continue
    }
    const file = await projectOwnedFile(match[1], projectRoot)
    if (file) {
      return { file, line: Number(match[2]) }
    }
  }
  return null
}
