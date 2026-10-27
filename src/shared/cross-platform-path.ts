import { isWslUncPath, parseWslUncPath, toWindowsWslPath } from './wsl-paths'

const SLASH_CHAR_CODE = '/'.charCodeAt(0)

export function isWindowsAbsolutePathLike(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('//')
}

/** Use path syntax, never client OS: Windows drive/UNC roots fold case; WSL UNC and POSIX/macOS stay case-sensitive to avoid merging distinct SSH/WSL files. */
export function isCaseInsensitiveRuntimeRoot(rootPath: string): boolean {
  return isWindowsAbsolutePathLike(rootPath) && !isWslUncPath(rootPath)
}

export function normalizeRuntimePathSeparators(value: string): string {
  const normalized = collapseRuntimePathSlashes(
    value.includes('\\') ? value.replace(/\\/g, '/') : value
  )
  if (value.startsWith('\\\\') || value.startsWith('//')) {
    return `//${normalized.replace(/^\/+/, '')}`
  }
  return normalized
}

/** Probe // before the dominant FS-event scan; includes is ~30x cheaper than unconditional replacement. */
function collapseRuntimePathSlashes(value: string): string {
  return value.includes('//') ? value.replace(/\/+/g, '/') : value
}

/** Comparison keys only, never real paths. NFC unifies macOS picker NFD with agent NFC (#10832); this knowingly permits canonical equivalence on byte-exact Linux/SSH hosts. */
export function normalizeRuntimePathForComparison(rawValue: string): string {
  // Normalize before any folding so the WSL alias branch below is covered too.
  const value = rawValue.normalize('NFC')
  const isWindowsPath = isWindowsAbsolutePathLike(value)
  // Backslash is legal in POSIX names; fold only paths proving Windows drive/UNC semantics.
  const normalized = trimRuntimePathTrailingSlash(
    isWindowsPath ? normalizeRuntimePathSeparators(value) : collapseRuntimePathSlashes(value)
  )
  const wslUnc = normalized.match(/^\/\/(?:wsl\.localhost|wsl\$)\/([^/]+)(\/[\s\S]*)?$/i)
  if (wslUnc) {
    // WSL UNC aliases share a case-sensitive Linux tail; only distro/server components fold case.
    return `//wsl/${wslUnc[1].toLowerCase()}${wslUnc[2] ?? ''}`
  }
  return isWindowsPath ? normalized.toLowerCase() : normalized
}

/** Require caller UNC cwd to prove the distro: Linux tails repeat across distros, and a tail-only match could make worktree rm delete another distro’s directory. */
export function isWslUncPathForCallerLinuxPath(
  uncPath: string,
  linuxPath: string,
  callerDistro: string
): boolean {
  const parsed = parseWslUncPath(uncPath)
  // Why the case split: Windows folds the distro name, the Linux tail it fronts is case-sensitive.
  return (
    parsed !== null &&
    parsed.distro.toLowerCase() === callerDistro.toLowerCase() &&
    normalizeRuntimePathForComparison(parsed.linuxPath) ===
      normalizeRuntimePathForComparison(linuxPath)
  )
}

/** Windows-backed /mnt/<drive> paths are shared across distros, so they need no caller-distro proof. */
export function isWslUncPathForLinuxMountedPath(uncPath: string, linuxPath: string): boolean {
  const parsed = parseWslUncPath(uncPath)
  if (!parsed || !/^\/mnt\/[A-Za-z](?:\/|$)/.test(parsed.linuxPath)) {
    return false
  }
  if (!/^\/mnt\/[A-Za-z](?:\/|$)/.test(linuxPath)) {
    return false
  }
  return (
    normalizeRuntimePathForComparison(toWindowsWslPath(parsed.linuxPath, parsed.distro)) ===
    normalizeRuntimePathForComparison(toWindowsWslPath(linuxPath, parsed.distro))
  )
}

export function areLocalWindowsWslPathAliases(left: string, right: string): boolean {
  const leftIdentity = getLocalWindowsWslPathIdentity(left)
  const rightIdentity = getLocalWindowsWslPathIdentity(right)
  return (
    (leftIdentity.isWslUnc || rightIdentity.isWslUnc) &&
    leftIdentity.aliasComparisonPath === rightIdentity.aliasComparisonPath
  )
}

export type LocalWindowsWslPathIdentity = {
  normalizedPath: string
  aliasComparisonPath: string
  isWslUnc: boolean
}

export function getLocalWindowsWslPathIdentity(value: string): LocalWindowsWslPathIdentity {
  const wslPath = parseWslUncPath(value)
  const normalizedPath = normalizeRuntimePathForComparison(value)
  return {
    normalizedPath,
    aliasComparisonPath: wslPath
      ? normalizeRuntimePathForComparison(toWindowsWslPath(wslPath.linuxPath, wslPath.distro))
      : normalizedPath,
    isWslUnc: wslPath !== null
  }
}

export function isRuntimePathAbsolute(
  value: string,
  pathFlavor: 'posix' | 'windows' = isWindowsPathFlavor(value) ? 'windows' : 'posix'
): boolean {
  const isWindowsAbsolute =
    /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\') || value.startsWith('/')
  return pathFlavor === 'windows' ? isWindowsAbsolute : value.startsWith('/')
}

export function resolveRuntimePath(basePath: string, targetPath: string): string {
  const pathFlavor =
    isWindowsPathFlavor(basePath) || isWindowsPathFlavor(targetPath) ? 'windows' : 'posix'
  const resolvedPath = isRuntimePathAbsolute(targetPath, pathFlavor)
    ? targetPath
    : `${trimRuntimePathTrailingSlash(normalizeRuntimePathSeparators(basePath))}/${targetPath}`
  return normalizeRuntimePathDots(resolvedPath, pathFlavor)
}

export function getRuntimePathBasename(value: string): string {
  const trimmed = value.replace(/[\\/]+$/g, '')
  return trimmed ? (trimmed.split(/[\\/]/).findLast(Boolean) ?? '') : ''
}

type AbsoluteRuntimePathParts = {
  root: string
  segments: string[]
  caseInsensitive: boolean
}

function splitAbsoluteRuntimePath(value: string): AbsoluteRuntimePathParts | null {
  const windowsPath = isWindowsAbsolutePathLike(value)
  const normalized = trimRuntimePathTrailingSlash(
    windowsPath ? normalizeRuntimePathSeparators(value) : value.replace(/\/+/g, '/')
  )
  const drive = normalized.match(/^([A-Za-z]:)(?:\/|$)/)
  if (drive) {
    return {
      root: `${drive[1]}/`,
      segments: normalized.slice(drive[0].length).split('/').filter(Boolean),
      caseInsensitive: true
    }
  }
  if (normalized.startsWith('//')) {
    const parts = normalized.slice(2).split('/')
    if (parts.length < 2 || !parts[0] || !parts[1]) {
      return null
    }
    return {
      root: `//${parts[0]}/${parts[1]}/`,
      segments: parts.slice(2).filter(Boolean),
      caseInsensitive: isCaseInsensitiveRuntimeRoot(normalized)
    }
  }
  if (!normalized.startsWith('/')) {
    return null
  }
  return {
    root: '/',
    segments: normalized.slice(1).split('/').filter(Boolean),
    caseInsensitive: false
  }
}

export function getRuntimePathParent(value: string): string | null {
  const parts = splitAbsoluteRuntimePath(value)
  if (!parts) {
    return null
  }
  parts.segments.pop()
  return parts.segments.length > 0
    ? `${parts.root}${parts.segments.join('/')}`
    : trimRuntimePathTrailingSlash(parts.root)
}

export function getDeepestCommonRuntimePath(paths: readonly string[]): string | null {
  const first = paths.length > 0 ? splitAbsoluteRuntimePath(paths[0]) : null
  if (!first) {
    return null
  }
  let commonLength = first.segments.length
  const rootKey = normalizeRuntimePathForComparison(first.root)
  for (let pathIndex = 1; pathIndex < paths.length; pathIndex++) {
    const candidate = splitAbsoluteRuntimePath(paths[pathIndex])
    if (!candidate || normalizeRuntimePathForComparison(candidate.root) !== rootKey) {
      return null
    }
    commonLength = Math.min(commonLength, candidate.segments.length)
    for (let segmentIndex = 0; segmentIndex < commonLength; segmentIndex++) {
      const left = first.segments[segmentIndex].normalize('NFC')
      const right = candidate.segments[segmentIndex].normalize('NFC')
      const matches = first.caseInsensitive
        ? left.toLowerCase() === right.toLowerCase()
        : left === right
      if (!matches) {
        commonLength = segmentIndex
        break
      }
    }
  }
  return commonLength > 0
    ? `${first.root}${first.segments.slice(0, commonLength).join('/')}`
    : trimRuntimePathTrailingSlash(first.root)
}

/** Normalize roots once; require already-normalized candidates. WSL UNC normalization is not idempotent (a second pass lowercases the Linux tail), so raw candidates silently mismatch. */
export function createNormalizedPathInsideOrEqualMatcher(
  rootPath: string
): (normalizedCandidate: string) => boolean {
  const root = normalizeRuntimePathForComparison(rootPath)
  const rootWithBoundary =
    root === '/' || /^[a-z]:\/$/i.test(root) ? root : `${root.replace(/\/+$/, '')}/`
  return (normalizedCandidate) =>
    normalizedCandidate === root || normalizedCandidate.startsWith(rootWithBoundary)
}

export function isPathInsideOrEqual(rootPath: string, candidatePath: string): boolean {
  return createNormalizedPathInsideOrEqualMatcher(rootPath)(
    normalizeRuntimePathForComparison(candidatePath)
  )
}

export function relativePathInsideRoot(rootPath: string, candidatePath: string): string | null {
  // Classify Windows syntax on NFC too (Kelvin folds to K), preserving raw bytes for returned suffixes; otherwise comparison and slicing count different segments.
  const normalizedCandidate = trimRuntimePathTrailingSlash(
    isWindowsAbsolutePathLike(candidatePath.normalize('NFC'))
      ? normalizeRuntimePathSeparators(candidatePath)
      : collapseRuntimePathSlashes(candidatePath)
  )
  const comparisonRoot = normalizeRuntimePathForComparison(rootPath)
  const comparisonCandidate = normalizeRuntimePathForComparison(candidatePath)

  if (comparisonCandidate === comparisonRoot) {
    return ''
  }
  const isRoot = comparisonRoot === '/' || /^[a-z]:\/$/i.test(comparisonRoot)
  const comparisonPrefix = isRoot ? comparisonRoot : `${comparisonRoot}/`
  if (!comparisonCandidate.startsWith(comparisonPrefix)) {
    return null
  }
  return sliceCandidatePastRootSegments(comparisonRoot, normalizedCandidate)
}

/** Skip whole root segments: NFC/case/UNC folding changes prefix lengths, so character slicing corrupts real suffixes. Scan without allocations during watcher storms. */
function sliceCandidatePastRootSegments(root: string, candidate: string): string {
  let remainingRootSegments = 0
  let inRootSegment = false
  for (let index = 0; index < root.length; index++) {
    if (root.charCodeAt(index) === SLASH_CHAR_CODE) {
      inRootSegment = false
    } else if (!inRootSegment) {
      inRootSegment = true
      remainingRootSegments++
    }
  }

  let inSegment = false
  for (let index = 0; index < candidate.length; index++) {
    if (candidate.charCodeAt(index) === SLASH_CHAR_CODE) {
      inSegment = false
      continue
    }
    if (!inSegment) {
      inSegment = true
      if (remainingRootSegments-- === 0) {
        return candidate.slice(index)
      }
    }
  }
  return ''
}

function trimRuntimePathTrailingSlash(value: string): string {
  // Nothing to trim, and neither preserved-root case can match, unless the value ends in `/`.
  if (!value.endsWith('/')) {
    return value
  }
  if (value === '/' || /^[A-Za-z]:\/$/.test(value)) {
    return value
  }
  return value.replace(/\/+$/, '')
}

function isWindowsPathFlavor(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.includes('\\') || value.startsWith('//')
}

function normalizeRuntimePathDots(value: string, pathFlavor: 'posix' | 'windows'): string {
  const normalized = normalizeRuntimePathSeparators(value)
  const { root, rest } = splitRuntimePathRoot(normalized, pathFlavor)
  const segments: string[] = []
  for (const segment of rest.split('/')) {
    if (!segment || segment === '.') {
      continue
    }
    if (segment === '..') {
      if (segments.length > 0 && segments.at(-1) !== '..') {
        segments.pop()
      } else if (!root) {
        segments.push(segment)
      }
      continue
    }
    segments.push(segment)
  }
  const suffix = segments.join('/')
  if (!root) {
    return suffix || '.'
  }
  return suffix ? `${root}${suffix}` : trimRuntimePathTrailingSlash(root)
}

function splitRuntimePathRoot(
  value: string,
  pathFlavor: 'posix' | 'windows'
): { root: string; rest: string } {
  if (pathFlavor === 'windows') {
    const drive = value.match(/^([A-Za-z]:)(?:\/|$)/)
    if (drive) {
      return { root: `${drive[1]}/`, rest: value.slice(drive[0].length) }
    }
    if (value.startsWith('//')) {
      const parts = value.slice(2).split('/')
      if (parts.length >= 2 && parts[0] && parts[1]) {
        const root = `//${parts[0]}/${parts[1]}/`
        return { root, rest: parts.slice(2).join('/') }
      }
      return { root: '//', rest: value.slice(2) }
    }
    if (value.startsWith('/')) {
      return { root: '/', rest: value.slice(1) }
    }
  }
  if (value.startsWith('/')) {
    return { root: '/', rest: value.slice(1) }
  }
  return { root: '', rest: value }
}
