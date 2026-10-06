import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync
} from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomically } from '../codex-accounts/fs-utils'
import {
  deleteActiveClaudeKeychainCredentialsStrict,
  readActiveClaudeKeychainCredentialsStrict,
  writeActiveClaudeKeychainCredentials
} from './keychain'
import { getClaudeManagedAccountsRoot } from './managed-auth-path'

/**
 * A project-pinned Claude account runs with CLAUDE_CONFIG_DIR pointed at its own
 * home so it can run beside the globally selected account. Everything except
 * auth is linked back to the user's real Claude config dir, so settings, memory,
 * plugins, skills and session history stay shared across accounts.
 */

// Why: these hold the signed-in identity, so each account home keeps its own copy.
const ACCOUNT_LOCAL_ENTRIES = new Set(['.credentials.json', '.claude.json'])

export function getClaudePinnedAccountHomePath(accountId: string): string {
  return join(getClaudeManagedAccountsRoot(), accountId, 'home')
}

function linkSharedEntry(sourcePath: string, targetPath: string): void {
  let isDirectory: boolean
  try {
    isDirectory = statSync(sourcePath).isDirectory()
  } catch {
    return
  }
  try {
    // Why: junctions need no Developer Mode on Windows; file symlinks may, hence the copy fallback.
    symlinkSync(
      sourcePath,
      targetPath,
      isDirectory && process.platform === 'win32' ? 'junction' : undefined
    )
  } catch (error) {
    if (isDirectory) {
      console.warn('[claude-project-pin] could not link shared Claude dir:', targetPath, error)
      return
    }
    try {
      copyFileSync(sourcePath, targetPath)
    } catch (copyError) {
      console.warn('[claude-project-pin] could not share Claude file:', targetPath, copyError)
    }
  }
}

/** Links each user config entry the account home doesn't already have. */
export function linkSharedClaudeConfigIntoPinnedHome(
  homePath: string,
  sharedConfigDir: string
): void {
  mkdirSync(homePath, { recursive: true, mode: 0o700 })
  let entries: string[]
  try {
    entries = readdirSync(sharedConfigDir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (ACCOUNT_LOCAL_ENTRIES.has(entry)) {
      continue
    }
    const targetPath = join(homePath, entry)
    try {
      lstatSync(targetPath)
      // Already linked, or created by Claude inside this home; leave it alone.
      continue
    } catch {
      // Missing — link it below.
    }
    linkSharedEntry(join(sharedConfigDir, entry), targetPath)
  }
}

function readJsonObject(path: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * Refreshes the home's global config from the user's so MCP servers, trust and
 * preferences follow them, while keeping this account's signed-in identity.
 */
export function writePinnedHomeGlobalConfig(
  homePath: string,
  sharedConfigPath: string,
  oauthAccount: unknown
): void {
  const homeConfigPath = join(homePath, '.claude.json')
  const shared = readJsonObject(sharedConfigPath) ?? {}
  const existing = readJsonObject(homeConfigPath) ?? {}
  const sharedProjects = (shared.projects ?? {}) as Record<string, unknown>
  const existingProjects = (existing.projects ?? {}) as Record<string, unknown>
  const next: Record<string, unknown> = {
    ...existing,
    ...shared,
    projects: { ...existingProjects, ...sharedProjects }
  }
  if (oauthAccount && typeof oauthAccount === 'object') {
    next.oauthAccount = oauthAccount
  } else {
    delete next.oauthAccount
  }
  writeFileAtomically(homeConfigPath, `${JSON.stringify(next, null, 2)}\n`, {
    mode: 0o600
  })
}

export async function readPinnedHomeCredentials(homePath: string): Promise<string | null> {
  if (process.platform === 'darwin') {
    return readActiveClaudeKeychainCredentialsStrict(homePath)
  }
  const credentialsPath = join(homePath, '.credentials.json')
  return existsSync(credentialsPath) ? readFileSync(credentialsPath, 'utf-8') : null
}

export async function writePinnedHomeCredentials(
  homePath: string,
  credentialsJson: string
): Promise<void> {
  if (process.platform === 'darwin') {
    // Why: with CLAUDE_CONFIG_DIR set, Claude reads a Keychain item scoped to that path.
    await writeActiveClaudeKeychainCredentials(credentialsJson, homePath)
    return
  }
  writeFileAtomically(join(homePath, '.credentials.json'), credentialsJson, {
    mode: 0o600
  })
}

function oauthExpiresAt(credentialsJson: string | null): number {
  if (!credentialsJson) {
    return -1
  }
  try {
    const parsed = JSON.parse(credentialsJson) as {
      claudeAiOauth?: { expiresAt?: unknown }
    }
    const expiresAt = parsed.claudeAiOauth?.expiresAt
    return typeof expiresAt === 'number' && Number.isFinite(expiresAt) ? expiresAt : 0
  } catch {
    return -1
  }
}

/** Which copy holds the newer token; Claude refreshes in place, Orca refreshes the managed copy. */
export function pickFresherClaudeCredentials(
  managedCredentialsJson: string | null,
  homeCredentialsJson: string | null
): 'managed' | 'home' | 'same' {
  if (managedCredentialsJson === homeCredentialsJson) {
    return 'same'
  }
  return oauthExpiresAt(homeCredentialsJson) > oauthExpiresAt(managedCredentialsJson)
    ? 'home'
    : 'managed'
}

export function hasClaudePinnedAccountHome(accountId: string): boolean {
  return existsSync(getClaudePinnedAccountHomePath(accountId))
}

export async function removeClaudePinnedAccountHome(accountId: string): Promise<void> {
  const homePath = getClaudePinnedAccountHomePath(accountId)
  if (!existsSync(homePath)) {
    return
  }
  try {
    // Why: the non-strict variant also clears the unscoped item, i.e. the user's own login.
    await deleteActiveClaudeKeychainCredentialsStrict(homePath)
  } catch (error) {
    console.warn('[claude-project-pin] failed to delete pinned Keychain item:', error)
  }
  // Why: rmSync removes links themselves, never the shared config they point at.
  rmSync(homePath, { recursive: true, force: true })
}
