import { execFileSync, spawnSync } from 'node:child_process'
import process from 'node:process'

// Why upstream/main: forks often keep origin/main as a stale mirror and track the real base as upstream.
const REMOTE_BASE_REFS = ['origin/main', 'upstream/main']
// Local main may be the checked-out branch itself, so it is only a fallback.
const LOCAL_BASE_REF = 'main'

function isCommit(root, ref) {
  return (
    spawnSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
      cwd: root,
      stdio: 'ignore'
    }).status === 0
  )
}

function commitsSinceMergeBase(root, ref) {
  try {
    const mergeBase = execFileSync('git', ['merge-base', ref, 'HEAD'], {
      cwd: root,
      encoding: 'utf8'
    }).trim()
    return Number(
      execFileSync('git', ['rev-list', '--count', `${mergeBase}..HEAD`], {
        cwd: root,
        encoding: 'utf8'
      }).trim()
    )
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

/** Explicit refs win; otherwise the main-like ref the branch forked from most recently, so a stale mirror cannot widen the diff to the whole repo. */
export function resolveCodeQualityBaseRef(
  root,
  requested = undefined,
  envBase = process.env.ORCA_CODE_QUALITY_BASE
) {
  for (const explicit of [requested, envBase]) {
    if (explicit && isCommit(root, explicit)) {
      return explicit
    }
  }
  let nearest = null
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const candidate of REMOTE_BASE_REFS) {
    if (!isCommit(root, candidate)) {
      continue
    }
    const distance = commitsSinceMergeBase(root, candidate)
    if (nearest === null || distance < nearestDistance) {
      nearest = candidate
      nearestDistance = distance
    }
  }
  return nearest ?? (isCommit(root, LOCAL_BASE_REF) ? LOCAL_BASE_REF : null)
}
