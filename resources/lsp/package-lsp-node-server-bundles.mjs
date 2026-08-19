#!/usr/bin/env node
// Prepackage Node-based language servers as self-contained tar.gz bundles so
// user machines never need npm or a Node toolchain (Orca runs them under
// Electron's node via ELECTRON_RUN_AS_NODE). Mirrors the ADS web-server
// packaging approach: assets are published on a GitHub release and pinned by
// sha256 in config/lsp-node-server-bundles.json.
//
// Usage: node resources/lsp/package-lsp-node-server-bundles.mjs [--only <bundleId>]
// Outputs: resources/lsp/dist/<asset>.tar.gz + updated config JSON.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const scriptDir = import.meta.dirname
const repoRoot = resolve(scriptDir, '..', '..')
const distDir = join(scriptDir, 'dist')
const configPath = join(repoRoot, 'config', 'lsp-node-server-bundles.json')

export const RELEASE_TAG = 'lsp-node-bundles-v1'

// One bundle = one npm install tree = one tar.gz asset. `servers` maps Orca
// LspServerIds onto the bin (or explicit entry file) each session spawns.
const BUNDLES = [
  {
    bundleId: 'typescript-language-server',
    // typescript pinned to 5.x: 7.x is the native (Go) rewrite with no
    // tsserver.js, which typescript-language-server cannot drive.
    dependencies: { 'typescript-language-server': '*', typescript: '^5' },
    servers: { typescript: { bin: { package: 'typescript-language-server' } } }
  },
  {
    bundleId: 'vscode-langservers',
    dependencies: { 'vscode-langservers-extracted': '*' },
    servers: {
      json: {
        bin: { package: 'vscode-langservers-extracted', name: 'vscode-json-language-server' }
      },
      css: { bin: { package: 'vscode-langservers-extracted', name: 'vscode-css-language-server' } },
      html: {
        bin: { package: 'vscode-langservers-extracted', name: 'vscode-html-language-server' }
      }
    }
  },
  {
    bundleId: 'yaml-language-server',
    dependencies: { 'yaml-language-server': '*' },
    servers: { yaml: { bin: { package: 'yaml-language-server' } } }
  },
  {
    bundleId: 'pyright',
    dependencies: { pyright: '*' },
    servers: { pyright: { bin: { package: 'pyright', name: 'pyright-langserver' } } }
  },
  {
    bundleId: 'bash-language-server',
    dependencies: { 'bash-language-server': '*' },
    servers: { bash: { bin: { package: 'bash-language-server' }, extraArgs: ['start'] } }
  },
  {
    bundleId: 'dockerfile-language-server',
    dependencies: { 'dockerfile-language-server-nodejs': '*' },
    servers: { dockerfile: { bin: { package: 'dockerfile-language-server-nodejs' } } }
  },
  {
    bundleId: 'intelephense',
    dependencies: { intelephense: '*' },
    servers: { intelephense: { bin: { package: 'intelephense' } } }
  },
  {
    bundleId: 'vue-language-server',
    dependencies: { '@vue/language-server': '*', typescript: '^5' },
    servers: { vue: { bin: { package: '@vue/language-server' } } }
  }
]

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function readPackageJson(dir) {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'))
}

// npm writes bin as string (single) or object; resolve the requested name.
function resolveBinEntry(stagingDir, binSpec) {
  const packageDir = join(stagingDir, 'node_modules', ...binSpec.package.split('/'))
  const packageJson = readPackageJson(packageDir)
  const bin = packageJson.bin
  let relative
  if (typeof bin === 'string') {
    relative = bin
  } else if (bin && typeof bin === 'object') {
    const name = binSpec.name ?? Object.keys(bin)[0]
    relative = bin[name]
    if (!relative) {
      throw new Error(`bin "${name}" not found in ${binSpec.package} (${Object.keys(bin)})`)
    }
  }
  if (!relative) {
    throw new Error(`package ${binSpec.package} has no bin`)
  }
  const entryAbsolute = join(packageDir, relative)
  if (!existsSync(entryAbsolute)) {
    throw new Error(`resolved bin does not exist: ${entryAbsolute}`)
  }
  return ['node_modules', ...binSpec.package.split('/'), ...relative.split('/')]
    .filter((part) => part !== '.')
    .join('/')
}

function removeDotBinDirs(dir) {
  if (!existsSync(dir)) {
    return
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }
    const child = join(dir, entry.name)
    if (entry.name === '.bin') {
      rmSync(child, { recursive: true, force: true })
    } else {
      removeDotBinDirs(child)
    }
  }
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`)
  }
}

function packageBundle(bundle) {
  const stagingDir = join(distDir, `.staging-${bundle.bundleId}`)
  rmSync(stagingDir, { recursive: true, force: true })
  mkdirSync(stagingDir, { recursive: true })
  writeFileSync(
    join(stagingDir, 'package.json'),
    JSON.stringify(
      { name: `orca-lsp-${bundle.bundleId}`, private: true, dependencies: bundle.dependencies },
      null,
      2
    )
  )
  run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], stagingDir)

  const primaryPackage = Object.keys(bundle.dependencies)[0]
  const primaryDir = join(stagingDir, 'node_modules', ...primaryPackage.split('/'))
  const version = readPackageJson(primaryDir).version
  const asset = `${bundle.bundleId}-${version}.tar.gz`
  const assetPath = join(distDir, asset)
  rmSync(assetPath, { force: true })
  // .bin shims are symlinks Windows bsdtar can't extract; sessions spawn the
  // resolved entry file directly, so drop them from the payload.
  removeDotBinDirs(join(stagingDir, 'node_modules'))
  // Deterministic-ish tar: sort names; contents come from the npm registry.
  run('tar', ['-czf', assetPath, '-C', stagingDir, 'package.json', 'node_modules'], repoRoot)

  const servers = {}
  for (const [serverId, spec] of Object.entries(bundle.servers)) {
    servers[serverId] = {
      entryRelativePath: resolveBinEntry(stagingDir, spec.bin),
      ...(spec.extraArgs ? { extraArgs: spec.extraArgs } : {})
    }
  }
  rmSync(stagingDir, { recursive: true, force: true })
  return {
    bundleId: bundle.bundleId,
    version,
    asset,
    sha256: sha256File(assetPath),
    servers
  }
}

function main() {
  const onlyFlagIndex = process.argv.indexOf('--only')
  const only = onlyFlagIndex !== -1 ? process.argv[onlyFlagIndex + 1] : null
  mkdirSync(distDir, { recursive: true })

  const existing = existsSync(configPath)
    ? JSON.parse(readFileSync(configPath, 'utf-8'))
    : { releaseTag: RELEASE_TAG, bundles: {} }
  const bundlesToBuild = BUNDLES.filter((bundle) => !only || bundle.bundleId === only)
  if (bundlesToBuild.length === 0) {
    throw new Error(`unknown bundle id: ${only}`)
  }
  for (const bundle of bundlesToBuild) {
    console.log(`\n=== Packaging ${bundle.bundleId} ===`)
    existing.bundles[bundle.bundleId] = packageBundle(bundle)
  }
  existing.releaseTag = RELEASE_TAG
  writeFileSync(configPath, `${JSON.stringify(existing, null, 2)}\n`)
  console.log(`\nWrote ${configPath}`)
  console.log(`Assets in ${distDir}:`)
  for (const file of readdirSync(distDir).filter((name) => name.endsWith('.tar.gz'))) {
    console.log(`  ${file}`)
  }
  console.log(`\nPublish assets to the GitHub release tagged ${RELEASE_TAG}.`)
}

main()
