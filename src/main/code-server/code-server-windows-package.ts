import { CODE_SERVER_VERSION } from './code-server-paths'

// coder publishes no Windows release, so Orca builds its own package in CI
// (.github/workflows/code-server-windows-package.yml) and downloads it at
// runtime. These constants mirror config/code-server-windows-package.json —
// the source of truth — and a tripwire test asserts they agree.
export const CODE_SERVER_WINDOWS_ASSET_NAME = `code-server-${CODE_SERVER_VERSION}-windows-amd64.zip`

// Published into the main repo like the ads-web-server-v* releases: rare tags
// can't evict app entries from the 10-entry releases atom feed, and the
// prefixed tag never parses as semver so electron-updater's feed scan skips it.
export const CODE_SERVER_WINDOWS_RELEASE_REPO = 'AVeryLostNomad/orca'

// Bumped for rebuilds of the same upstream version (new native-module build,
// different bundled Node) — release tags are immutable once published.
export const CODE_SERVER_WINDOWS_PACKAGE_REVISION = 1

export const CODE_SERVER_WINDOWS_RELEASE_TAG = `code-server-win32-v${CODE_SERVER_VERSION}-orca.${CODE_SERVER_WINDOWS_PACKAGE_REVISION}`

export const CODE_SERVER_WINDOWS_DOWNLOAD_URL = `https://github.com/${CODE_SERVER_WINDOWS_RELEASE_REPO}/releases/download/${CODE_SERVER_WINDOWS_RELEASE_TAG}/${CODE_SERVER_WINDOWS_ASSET_NAME}`

// Integrity pin for the downloaded zip. Empty until the first CI publish of a
// given version; the installer refuses to install while unset, so a version
// bump cannot ship an unpinned download. (Widened to string so guard-site
// narrowing doesn't collapse the literal to never.)
export const CODE_SERVER_WINDOWS_SHA256: string = ''

// A truncated download can still be a valid-looking zip prefix; the sha256 pin
// is the real integrity check, this only short-circuits obvious garbage.
export const CODE_SERVER_WINDOWS_MIN_VALID_BYTES = 50_000_000
