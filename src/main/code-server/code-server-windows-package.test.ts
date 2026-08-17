import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/userData') } }))

import { CODE_SERVER_VERSION } from './code-server-paths'
import {
  CODE_SERVER_WINDOWS_ASSET_NAME,
  CODE_SERVER_WINDOWS_DOWNLOAD_URL,
  CODE_SERVER_WINDOWS_PACKAGE_REVISION,
  CODE_SERVER_WINDOWS_RELEASE_REPO,
  CODE_SERVER_WINDOWS_RELEASE_TAG,
  CODE_SERVER_WINDOWS_SHA256
} from './code-server-windows-package'

// Tripwire: a version bump must update config/code-server-windows-package.json
// (which triggers the CI package build) and these runtime constants together.
describe('code-server windows package pins', () => {
  const pins = JSON.parse(
    readFileSync(join(__dirname, '../../../config/code-server-windows-package.json'), 'utf8')
  ) as {
    codeServerVersion: string
    nodeVersion: string
    packageRevision: number
    assetName: string
    releaseRepo: string
    releaseTag: string
    sha256: string
  }

  it('agrees with config/code-server-windows-package.json', () => {
    expect(pins.codeServerVersion).toBe(CODE_SERVER_VERSION)
    expect(pins.packageRevision).toBe(CODE_SERVER_WINDOWS_PACKAGE_REVISION)
    expect(pins.assetName).toBe(CODE_SERVER_WINDOWS_ASSET_NAME)
    expect(pins.releaseRepo).toBe(CODE_SERVER_WINDOWS_RELEASE_REPO)
    expect(pins.releaseTag).toBe(CODE_SERVER_WINDOWS_RELEASE_TAG)
    expect(pins.sha256).toBe(CODE_SERVER_WINDOWS_SHA256)
  })

  // The release lives in the app repo, so the tag must never parse as a plain
  // semver version — electron-updater's feed scan would otherwise mistake it
  // for an app release (same convention as the ads-web-server-v* tags).
  it('uses a non-semver-parseable release tag', () => {
    expect(CODE_SERVER_WINDOWS_RELEASE_TAG).toMatch(/^code-server-win32-v/)
    expect(/^v?\d+\.\d+\.\d+/.test(CODE_SERVER_WINDOWS_RELEASE_TAG)).toBe(false)
  })

  it('embeds the pinned version in the asset name and download URL', () => {
    expect(CODE_SERVER_WINDOWS_ASSET_NAME).toContain(CODE_SERVER_VERSION)
    expect(CODE_SERVER_WINDOWS_DOWNLOAD_URL).toBe(
      `https://github.com/${pins.releaseRepo}/releases/download/${pins.releaseTag}/${pins.assetName}`
    )
  })

  it('pins an exact Node version for the bundled node.exe ABI', () => {
    expect(pins.nodeVersion).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('has a 64-hex sha256 pin (or the empty pre-first-publish sentinel)', () => {
    expect(CODE_SERVER_WINDOWS_SHA256).toMatch(/^(?:[0-9a-f]{64})?$/)
  })
})
