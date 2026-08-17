import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { app } from 'electron'
import { ORCA_DATASTUDIO_PARTITION_PREFIX } from '../../shared/constants'

// On-disk layout (all under <userData>/data-studio):
//   profiles/<hash16>/user-data   — per-repo --user-data-dir: connection settings
//                                   (mssql.connections / sqltools.connections in
//                                   User/settings.json) plus code-server's
//                                   serve-web-key-half, the server half of the
//                                   secret-storage AES key. Deleting it orphans
//                                   the repo's saved DB passwords.
//   profiles/<hash16>/meta.json   — { repoId, repoPath } breadcrumb (hash is one-way)
//   profiles/<hash16>/code-server.pid
//   extensions/                   — shared across repos: pinned DB extensions and
//                                   their tool-service payloads download once.
//   ports.json                    — stable repoIdHash → port map (secret storage
//                                   is keyed to the http origin, so ports persist).

export function getDataStudioRoot(): string {
  return join(app.getPath('userData'), 'data-studio')
}

export function getDataStudioProfilesRoot(): string {
  return join(getDataStudioRoot(), 'profiles')
}

/** First 16 hex chars of SHA-256 — repo ids are path-derived and filesystem-hostile. */
export function hashRepoId(repoId: string): string {
  return createHash('sha256').update(repoId).digest('hex').slice(0, 16)
}

export function getDataStudioProfileDir(repoId: string): string {
  return join(getDataStudioProfilesRoot(), hashRepoId(repoId))
}

export function getDataStudioProfileUserDataDir(repoId: string): string {
  return join(getDataStudioProfileDir(repoId), 'user-data')
}

export function getDataStudioProfilePidFilePath(repoId: string): string {
  return join(getDataStudioProfileDir(repoId), 'code-server.pid')
}

export function getDataStudioExtensionsDir(): string {
  return join(getDataStudioRoot(), 'extensions')
}

// Throwaway user-data-dir for `code-server --install-extension` runs, so
// provisioning never dirties any repo profile.
export function getDataStudioProvisionUserDataDir(): string {
  return join(getDataStudioRoot(), 'provision-user-data')
}

export function getDataStudioPortsFilePath(): string {
  return join(getDataStudioRoot(), 'ports.json')
}

export function getDataStudioPartition(repoId: string): string {
  return `${ORCA_DATASTUDIO_PARTITION_PREFIX}${hashRepoId(repoId)}`
}

/** Create the profile dir and drop the reverse-lookup breadcrumb (idempotent). */
export function ensureDataStudioProfileDir(repoId: string, repoPath: string | null): string {
  const dir = getDataStudioProfileDir(repoId)
  mkdirSync(join(dir, 'user-data'), { recursive: true })
  const metaPath = join(dir, 'meta.json')
  if (!existsSync(metaPath)) {
    try {
      writeFileSync(
        metaPath,
        `${JSON.stringify({ repoId, repoPath, createdAt: new Date().toISOString() }, null, 2)}\n`
      )
    } catch {
      // Breadcrumb only — never block a start on it.
    }
  }
  return dir
}
