import { readdir, readFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'
import type { UnityAssetUsage, UnityAssetUsageKind } from '../../shared/unity-types'
import { bundledRipgrepCommand } from '../ripgrep/bundled-ripgrep-path'
import { unityProjectKey } from './unity-editor-bridge'
import { findUnityProjectRootFor } from './unity-project-detect'
import { runUnityToolProcess } from './unity-tool-process'

// Text-serialized assets that can hold MonoBehaviour/ScriptableObject script references.
const SCANNED_EXTENSIONS = [
  'unity',
  'prefab',
  'asset',
  'controller',
  'overrideController',
  'playable',
  'anim'
]

const KIND_BY_EXTENSION: Record<string, UnityAssetUsageKind> = {
  '.unity': 'scene',
  '.prefab': 'prefab',
  '.asset': 'scriptable-object'
}

const KIND_ORDER: Record<UnityAssetUsageKind, number> = {
  scene: 0,
  prefab: 1,
  'scriptable-object': 2,
  other: 3
}

const CACHE_TTL_MS = 15_000
const RIPGREP_TIMEOUT_MS = 60_000
const RIPGREP_OUTPUT_LIMIT_BYTES = 32 * 1024 * 1024
const METHOD_FILE_READ_CONCURRENCY = 8
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

type CacheEntry = { at: number; usages: Promise<UnityAssetUsage[]> }

const cache = new Map<string, CacheEntry>()

type ScriptTarget = { projectRoot: string; guid: string; className: string }

async function resolveScriptTarget(scriptPath: unknown): Promise<ScriptTarget | null> {
  if (typeof scriptPath !== 'string' || !isAbsolute(scriptPath)) {
    return null
  }
  const absolute = resolve(scriptPath)
  const projectRoot = await findUnityProjectRootFor(absolute)
  if (!projectRoot) {
    return null
  }
  const meta = await readFile(`${absolute}.meta`, 'utf8').catch(() => null)
  const guid = meta ? /^guid:\s*([0-9a-f]{32})\s*$/m.exec(meta)?.[1] : undefined
  return guid ? { projectRoot, guid, className: basename(absolute, extname(absolute)) } : null
}

/** Assets/ plus embedded packages: real directories under Packages/ (registry packages live in the read-only cache). */
async function searchRoots(projectRoot: string): Promise<string[]> {
  const packages = await readdir(join(projectRoot, 'Packages'), { withFileTypes: true }).catch(
    () => []
  )
  return [
    'Assets',
    ...packages.filter((entry) => entry.isDirectory()).map((entry) => join('Packages', entry.name))
  ]
}

/** Every fixed-string occurrence of `needle` in scanned assets, as project-relative path + 1-based line. */
async function findOccurrences(
  projectRoot: string,
  needle: string
): Promise<{ path: string; line: number }[]> {
  const args = [
    '--no-config',
    '--no-ignore',
    '--fixed-strings',
    '--only-matching',
    '--line-number',
    '--with-filename',
    '--no-heading',
    '--null',
    '--color',
    'never',
    ...SCANNED_EXTENSIONS.flatMap((extension) => ['--glob', `*.${extension}`]),
    '--regexp',
    needle,
    '--',
    ...(await searchRoots(projectRoot))
  ]
  let run
  try {
    run = await runUnityToolProcess({
      program: bundledRipgrepCommand(),
      args,
      cwd: projectRoot,
      timeoutMs: RIPGREP_TIMEOUT_MS,
      maxOutputBytes: RIPGREP_OUTPUT_LIMIT_BYTES
    })
  } catch (error) {
    console.warn('[unity] asset usage search could not start ripgrep', error)
    return []
  }
  // Exit 1 is "no matches"; exit 2 still prints the matches found before an unreadable file.
  if (run.code !== 0 && run.code !== 1 && run.code !== 2) {
    console.warn('[unity] asset usage search failed', run.code, run.stderr.slice(-500))
    return []
  }
  return run.stdout.split('\n').flatMap((record) => {
    const separator = record.indexOf('\0')
    const line = separator > 0 ? Number.parseInt(record.slice(separator + 1), 10) : Number.NaN
    return Number.isFinite(line) ? [{ path: record.slice(0, separator), line }] : []
  })
}

function toUsage(projectRoot: string, path: string, line: number, count: number): UnityAssetUsage {
  return {
    assetPath: join(projectRoot, path),
    kind: KIND_BY_EXTENSION[extname(path).toLowerCase()] ?? 'other',
    line,
    count
  }
}

function sortUsages(usages: UnityAssetUsage[]): UnityAssetUsage[] {
  return usages.sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.assetPath.localeCompare(b.assetPath)
  )
}

function cached(key: string, load: () => Promise<UnityAssetUsage[]>): Promise<UnityAssetUsage[]> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.usages
  }
  const usages = load().catch((error: unknown) => {
    cache.delete(key)
    throw error
  })
  cache.set(key, { at: Date.now(), usages })
  return usages
}

export async function findScriptAssetUsages(scriptPath: string): Promise<UnityAssetUsage[]> {
  const target = await resolveScriptTarget(scriptPath)
  if (!target) {
    return []
  }
  const { projectRoot, guid } = target
  return cached(`${unityProjectKey(projectRoot)}|script|${guid}`, async () => {
    const byPath = new Map<string, { line: number; count: number }>()
    for (const occurrence of await findOccurrences(projectRoot, `guid: ${guid}`)) {
      const entry = byPath.get(occurrence.path)
      if (entry) {
        entry.count += 1
        entry.line = Math.min(entry.line, occurrence.line)
      } else {
        byPath.set(occurrence.path, { line: occurrence.line, count: 1 })
      }
    }
    return sortUsages(
      [...byPath].map(([path, entry]) => toUsage(projectRoot, path, entry.line, entry.count))
    )
  })
}

/**
 * UnityEvent persistent calls naming `methodName` that target this script. Approximation: a call
 * matches when its m_Target is a MonoBehaviour document (in the same file) whose m_Script carries
 * the script GUID, or that component's GameObject, or when m_TargetAssemblyTypeName names the
 * script's class (covers targets inside nested prefab instances). Inherited methods bound through
 * a subclass component and calls made from code are not found.
 */
export function countMethodBindings(
  text: string,
  target: { guid: string; className: string },
  methodName: string
): { count: number; line: number } | null {
  const scriptComponents = new Set<string>()
  const scriptGameObjects = new Set<string>()
  const calls: { target: string; typeName?: string; method?: string; line: number }[] = []
  let document: { fileId: string; classId: string; gameObject?: string; isScript: boolean } | null =
    null
  let call: (typeof calls)[number] | null = null
  const closeDocument = (): void => {
    if (document?.isScript) {
      scriptComponents.add(document.fileId)
      if (document.gameObject) {
        scriptGameObjects.add(document.gameObject)
      }
    }
  }
  const lines = text.split(/\r?\n/)
  for (const [index, line] of lines.entries()) {
    const header = /^--- !u!(\d+) &(-?\d+)/.exec(line)
    if (header) {
      closeDocument()
      document = { classId: header[1], fileId: header[2], isScript: false }
      call = null
      continue
    }
    if (document?.classId === '114') {
      const script = /^ {2}m_Script: \{fileID: -?\d+, guid: ([0-9a-f]{32})/.exec(line)
      if (script) {
        document.isScript = script[1] === target.guid
      }
      const gameObject = /^ {2}m_GameObject: \{fileID: (-?\d+)/.exec(line)
      if (gameObject) {
        document.gameObject = gameObject[1]
      }
    }
    const callTarget = /^\s*- m_Target: \{fileID: (-?\d+)/.exec(line)
    if (callTarget) {
      call = { target: callTarget[1], line: index + 1 }
      calls.push(call)
      continue
    }
    if (call) {
      const typeName = /^\s*m_TargetAssemblyTypeName: (.*)$/.exec(line)
      if (typeName) {
        call.typeName = typeName[1].trim()
      }
      const method = /^\s*m_MethodName: (.*)$/.exec(line)
      if (method) {
        call.method = method[1].trim()
        call.line = index + 1
      }
    }
  }
  closeDocument()
  const typeIsScript = (typeName: string): boolean => {
    const type = typeName.split(',')[0].trim()
    return (
      type.slice(Math.max(type.lastIndexOf('.'), type.lastIndexOf('+')) + 1) === target.className
    )
  }
  const matching = calls.filter(
    (candidate) =>
      candidate.method === methodName &&
      (scriptComponents.has(candidate.target) ||
        (candidate.typeName
          ? typeIsScript(candidate.typeName)
          : scriptGameObjects.has(candidate.target)))
  )
  return matching.length > 0
    ? { count: matching.length, line: Math.min(...matching.map((candidate) => candidate.line)) }
    : null
}

export async function findMethodAssetUsages(
  scriptPath: string,
  methodName: string
): Promise<UnityAssetUsage[]> {
  if (typeof methodName !== 'string' || !IDENTIFIER.test(methodName)) {
    return []
  }
  const target = await resolveScriptTarget(scriptPath)
  if (!target) {
    return []
  }
  const { projectRoot, guid } = target
  return cached(`${unityProjectKey(projectRoot)}|method|${guid}|${methodName}`, async () => {
    const candidates = [
      ...new Set(
        (await findOccurrences(projectRoot, `m_MethodName: ${methodName}`)).map(
          (occurrence) => occurrence.path
        )
      )
    ]
    const usages: UnityAssetUsage[] = []
    for (let start = 0; start < candidates.length; start += METHOD_FILE_READ_CONCURRENCY) {
      const batch = candidates.slice(start, start + METHOD_FILE_READ_CONCURRENCY)
      const results = await Promise.all(
        batch.map(async (path) => {
          const text = await readFile(join(projectRoot, path), 'utf8').catch(() => null)
          const bindings = text === null ? null : countMethodBindings(text, target, methodName)
          return bindings ? toUsage(projectRoot, path, bindings.line, bindings.count) : null
        })
      )
      usages.push(...results.filter((usage): usage is UnityAssetUsage => usage !== null))
    }
    return sortUsages(usages)
  })
}
