import { MAIN_RELEASE_REPO } from '../shared/release-channel'
import { escapeRegex } from '../shared/string-utils'

const RELEASES_URL = `https://github.com/${MAIN_RELEASE_REPO}/releases`
export const ATOM_FEED_URL = `${RELEASES_URL}.atom`
export const RELEASES_DOWNLOAD_BASE = `${RELEASES_URL}/download`
export const RELEASES_LATEST_URL = `${RELEASES_URL}/latest`
export const RELEASES_LATEST_DOWNLOAD_URL = `${RELEASES_LATEST_URL}/download`

// Atom includes stable and prerelease tags without channel filtering.
export const TAG_HREF_RE = new RegExp(
  `href="https://github\\.com/${escapeRegex(MAIN_RELEASE_REPO)}/releases/tag/([^"]+)"`,
  'g'
)
export const LATEST_TAG_PATH_RE = new RegExp(
  `^/${escapeRegex(MAIN_RELEASE_REPO)}/releases/tag/([^/]+)$`
)
