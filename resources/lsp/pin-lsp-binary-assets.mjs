#!/usr/bin/env node
// Pin prebuilt language-server binaries (rust-analyzer, clangd, lua-language-
// server, marksman, taplo, terraform-ls) to exact versions + sha256 digests in
// config/lsp-binary-assets.json. Run when adopting or bumping a server version;
// the runtime installer only trusts what this file pins.
//
// Usage: node resources/lsp/pin-lsp-binary-assets.mjs [--only <serverId>]
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const scriptDir = import.meta.dirname
const repoRoot = resolve(scriptDir, '..', '..')
const configPath = join(repoRoot, 'config', 'lsp-binary-assets.json')

const PLATFORM_KEYS = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'win32-x64']

// asset: platformKey -> substring/regex matching exactly one release asset.
const SERVERS = {
  'rust-analyzer': {
    github: 'rust-lang/rust-analyzer',
    binary: 'rust-analyzer',
    assets: {
      'darwin-arm64': /^rust-analyzer-aarch64-apple-darwin\.gz$/,
      'darwin-x64': /^rust-analyzer-x86_64-apple-darwin\.gz$/,
      'linux-x64': /^rust-analyzer-x86_64-unknown-linux-gnu\.gz$/,
      'linux-arm64': /^rust-analyzer-aarch64-unknown-linux-gnu\.gz$/,
      'win32-x64': /^rust-analyzer-x86_64-pc-windows-msvc\.(gz|zip)$/
    }
  },
  clangd: {
    github: 'clangd/clangd',
    binary: (version) => `clangd_${version}/bin/clangd`,
    assets: {
      // The mac zip is a universal binary.
      'darwin-arm64': /^clangd-mac-.*\.zip$/,
      'darwin-x64': /^clangd-mac-.*\.zip$/,
      'linux-x64': /^clangd-linux-.*\.zip$/,
      'win32-x64': /^clangd-windows-.*\.zip$/
    }
  },
  lua: {
    github: 'LuaLS/lua-language-server',
    binary: 'bin/lua-language-server',
    assets: {
      'darwin-arm64': /^lua-language-server-.*-darwin-arm64\.tar\.gz$/,
      'darwin-x64': /^lua-language-server-.*-darwin-x64\.tar\.gz$/,
      'linux-x64': /^lua-language-server-.*-linux-x64\.tar\.gz$/,
      'linux-arm64': /^lua-language-server-.*-linux-arm64\.tar\.gz$/,
      'win32-x64': /^lua-language-server-.*-win32-x64\.zip$/
    }
  },
  marksman: {
    github: 'artempyanykh/marksman',
    binary: 'marksman',
    assets: {
      'darwin-arm64': /^marksman-macos$/,
      'darwin-x64': /^marksman-macos$/,
      'linux-x64': /^marksman-linux-x64$/,
      'linux-arm64': /^marksman-linux-arm64$/,
      'win32-x64': /^marksman\.exe$/
    }
  },
  taplo: {
    github: 'tamasfe/taplo',
    binary: 'taplo',
    // Taplo's repo releases several crates; pick the newest release whose
    // assets include the full CLI builds.
    releaseFilter: (release) =>
      (release.assets ?? []).some((asset) => asset.name.startsWith('taplo-full-')),
    assets: {
      'darwin-arm64': /^taplo-full-darwin-aarch64\.gz$/,
      'darwin-x64': /^taplo-full-darwin-x86_64\.gz$/,
      'linux-x64': /^taplo-full-linux-x86_64\.gz$/,
      'linux-arm64': /^taplo-full-linux-aarch64\.gz$/,
      'win32-x64': /^taplo-full-windows-x86_64\.zip$/
    }
  }
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'orca-lsp-pin-script', accept: 'application/vnd.github+json' }
  })
  if (!response.ok) {
    throw new Error(`GET ${url} -> HTTP ${response.status}`)
  }
  return response.json()
}

async function sha256OfUrl(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'orca-lsp-pin-script' } })
  if (!response.ok) {
    throw new Error(`GET ${url} -> HTTP ${response.status}`)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  return { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }
}

function archiveKindFor(assetName) {
  if (assetName.endsWith('.tar.gz')) {
    return 'tar.gz'
  }
  if (assetName.endsWith('.zip')) {
    return 'zip'
  }
  if (assetName.endsWith('.gz')) {
    return 'gz'
  }
  return 'none'
}

function binaryPathFor(spec, version, platformKey) {
  const base = typeof spec.binary === 'function' ? spec.binary(version) : spec.binary
  return platformKey === 'win32-x64' && !base.endsWith('.exe') ? `${base}.exe` : base
}

async function pinGithubServer(serverId, spec) {
  const releases = await fetchJson(
    `https://api.github.com/repos/${spec.github}/releases?per_page=15`
  )
  const release = releases.find(
    (candidate) =>
      !candidate.draft &&
      !candidate.prerelease &&
      (!spec.releaseFilter || spec.releaseFilter(candidate))
  )
  if (!release) {
    throw new Error(`${serverId}: no matching release found`)
  }
  const version = release.tag_name.replace(/^.*?(\d)/, '$1')
  console.log(`${serverId}: ${release.tag_name} (${version})`)
  const assets = {}
  for (const platformKey of PLATFORM_KEYS) {
    const pattern = spec.assets[platformKey]
    if (!pattern) {
      continue
    }
    const asset = (release.assets ?? []).find((candidate) => pattern.test(candidate.name))
    if (!asset) {
      console.warn(`  ${platformKey}: no asset matching ${pattern} — skipped`)
      continue
    }
    process.stdout.write(`  ${platformKey}: ${asset.name} ... `)
    const { sha256, bytes } = await sha256OfUrl(asset.browser_download_url)
    console.log(`${(bytes / 1e6).toFixed(1)}MB ${sha256.slice(0, 12)}…`)
    assets[platformKey] = {
      url: asset.browser_download_url,
      sha256,
      archive: archiveKindFor(asset.name),
      binaryRelativePath: binaryPathFor(spec, version, platformKey)
    }
  }
  return { version, assets }
}

async function pinTerraformLs() {
  const meta = await fetchJson('https://api.releases.hashicorp.com/v1/releases/terraform-ls/latest')
  const version = meta.version
  console.log(`terraform: terraform-ls ${version}`)
  const sums = await (
    await fetch(
      `https://releases.hashicorp.com/terraform-ls/${version}/terraform-ls_${version}_SHA256SUMS`
    )
  ).text()
  const shaByFile = new Map(
    sums
      .trim()
      .split('\n')
      .map((line) => line.trim().split(/\s+/))
      .map(([sha, file]) => [file, sha])
  )
  const platformToHashicorp = {
    'darwin-arm64': 'darwin_arm64',
    'darwin-x64': 'darwin_amd64',
    'linux-x64': 'linux_amd64',
    'linux-arm64': 'linux_arm64',
    'win32-x64': 'windows_amd64'
  }
  const assets = {}
  for (const [platformKey, hashicorpKey] of Object.entries(platformToHashicorp)) {
    const file = `terraform-ls_${version}_${hashicorpKey}.zip`
    const sha256 = shaByFile.get(file)
    if (!sha256) {
      console.warn(`  ${platformKey}: ${file} missing from SHA256SUMS — skipped`)
      continue
    }
    console.log(`  ${platformKey}: ${file} ${sha256.slice(0, 12)}…`)
    assets[platformKey] = {
      url: `https://releases.hashicorp.com/terraform-ls/${version}/${file}`,
      sha256,
      archive: 'zip',
      binaryRelativePath: platformKey === 'win32-x64' ? 'terraform-ls.exe' : 'terraform-ls'
    }
  }
  return { version, assets }
}

async function main() {
  const onlyFlagIndex = process.argv.indexOf('--only')
  const only = onlyFlagIndex !== -1 ? process.argv[onlyFlagIndex + 1] : null
  let existing = { servers: {} }
  try {
    existing = JSON.parse(readFileSync(configPath, 'utf-8'))
  } catch {
    // First run.
  }
  const tasks = []
  for (const [serverId, spec] of Object.entries(SERVERS)) {
    if (only && serverId !== only) {
      continue
    }
    tasks.push([serverId, () => pinGithubServer(serverId, spec)])
  }
  if (!only || only === 'terraform') {
    tasks.push(['terraform', pinTerraformLs])
  }
  for (const [serverId, task] of tasks) {
    existing.servers[serverId] = await task()
  }
  writeFileSync(configPath, `${JSON.stringify(existing, null, 2)}\n`)
  console.log(`\nWrote ${configPath}`)
}

const tempProbe = mkdtempSync(join(tmpdir(), 'orca-lsp-pin-'))
rmSync(tempProbe, { recursive: true, force: true })
await main()
