import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readStoredCredentialToken, writeEncryptedCredential } from '../integration-credential-file'

// Token files for Orca-stored GitHub PAT accounts (per-project account
// pinning). Metadata (id/label/host) lives in GlobalSettings.githubPatAccounts.

function getTokenDir(): string {
  return join(homedir(), '.orca', 'github-tokens')
}

function getTokenPath(patId: string): string {
  return join(getTokenDir(), `${Buffer.from(patId).toString('base64url')}.enc`)
}

export function saveGithubPatToken(patId: string, token: string): void {
  const dir = getTokenDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeEncryptedCredential('GitHub', getTokenPath(patId), token)
}

/** Returns null when the file is missing/empty; throws CredentialDecryptionError
 *  when ciphertext exists but cannot be decrypted. */
export function loadGithubPatToken(patId: string): string | null {
  const path = getTokenPath(patId)
  if (!existsSync(path)) {
    return null
  }
  return readStoredCredentialToken('GitHub', readFileSync(path))
}

export function deleteGithubPatToken(patId: string): void {
  try {
    unlinkSync(getTokenPath(patId))
  } catch {
    // Missing file — nothing to delete.
  }
}
