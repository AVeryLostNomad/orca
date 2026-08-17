#!/usr/bin/env node
// Builds the Windows code-server package Orca installs at runtime (coder
// publishes no Windows release). Runs `npm install code-server@<pin>` on a
// Windows box whose Node exactly matches the pinned nodeVersion, assembles the
// standalone-tarball layout with that node.exe bundled as lib/node.exe, smoke
// tests it against /healthz, and zips it for the release repo named in
// config/code-server-windows-package.json.
//
// The bundled node.exe is the ABI contract: native modules are node-gyp-built
// by this exact runtime and always executed by it (never by Electron).
//
// Usage (windows-2022 CI or any Windows box with VS C++ build tools + Git sh):
//   node config/scripts/build-code-server-windows-package.mjs [--out-dir <dir>]

import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { get } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const PINS_PATH = resolve(import.meta.dirname, '../code-server-windows-package.json')
const HEALTHZ_TIMEOUT_MS = 60_000
const HEALTHZ_POLL_MS = 500

// Mirrors src/shared/windows-batch-spawn.ts: these characters can start a new
// command or expand a variable when cmd.exe re-parses the line for npm.cmd.
const UNSAFE_CMD_ARG = /[&|<>^"%!\r\n]/

export function hasUnsafeCmdArg(value) {
  return UNSAFE_CMD_ARG.test(value)
}

export function loadPins(pinsPath = PINS_PATH) {
  const pins = JSON.parse(readFileSync(pinsPath, 'utf8'))
  for (const key of [
    'codeServerVersion',
    'nodeVersion',
    'assetName',
    'releaseRepo',
    'releaseTag'
  ]) {
    if (typeof pins[key] !== 'string' || !pins[key]) {
      throw new Error(`config/code-server-windows-package.json is missing "${key}"`)
    }
  }
  return pins
}

export function assertRuntimeMatchesPins(pins, runtime = process) {
  if (runtime.platform !== 'win32') {
    throw new Error(`must run on win32 (got ${runtime.platform})`)
  }
  if (runtime.arch !== 'x64') {
    throw new Error(`must run on x64 (got ${runtime.arch}); Orca ships Windows x64 only`)
  }
  if (runtime.version !== `v${pins.nodeVersion}`) {
    throw new Error(
      `node ${runtime.version} does not match the pinned nodeVersion v${pins.nodeVersion} — ` +
        'native-module ABI would not match the bundled lib/node.exe'
    )
  }
}

export function packageDirName(pins) {
  return `code-server-${pins.codeServerVersion}-windows-amd64`
}

// Everything the runtime needs, spot-checked; extraction-side layout detection
// (code-server-windows-install.ts) relies on the single versioned top dir.
export function assertPackageLayout(rootDir, exists = existsSync) {
  const required = [
    join(rootDir, 'lib', 'node.exe'),
    join(rootDir, 'out', 'node', 'entry.js'),
    join(rootDir, 'lib', 'vscode', 'product.json'),
    join(rootDir, 'package.json')
  ]
  const missing = required.filter((p) => !exists(p))
  if (missing.length > 0) {
    throw new Error(`assembled package is missing: ${missing.join(', ')}`)
  }
}

// node-gyp build intermediates; keep build/Release/*.node (the artifacts).
export function shouldPrune(relPath) {
  const normalized = relPath.replace(/\\/g, '/')
  if (/\/build\/Release\/[^/]+\.node$/i.test(normalized)) {
    return false
  }
  return (
    /\/build\/(obj|.*\.(vcxproj|sln|filters|pdb|ilk|exp|lib))(\/|$)/i.test(normalized) ||
    /\/node_modules\/\.bin(\/|$)/.test(normalized) ||
    normalized.endsWith('/config.gypi')
  )
}

function runCmdShim(command, args, options = {}) {
  for (const value of [command, ...args]) {
    if (hasUnsafeCmdArg(value)) {
      throw new Error(`refusing to pass unsafe cmd.exe argument: ${value}`)
    }
  }
  const comSpec =
    process.env.ComSpec || join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe')
  return execFileSync(comSpec, ['/d', '/c', command, ...args], {
    stdio: 'inherit',
    windowsHide: true,
    ...options
  })
}

function npmInstallCodeServer(pins, workDir) {
  const registrySpec = `code-server@${pins.codeServerVersion}`
  // The npm registry can lag GitHub releases; the release's package.tar.gz is
  // the identical npm artifact and still runs postinstall/node-gyp locally.
  const releaseSpec = `https://github.com/coder/code-server/releases/download/v${pins.codeServerVersion}/package.tar.gz`
  const baseArgs = ['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error']
  writeFileSync(join(workDir, 'package.json'), JSON.stringify({ name: 'staging', private: true }))
  try {
    runCmdShim('npm', [...baseArgs, registrySpec], { cwd: workDir })
  } catch (error) {
    console.warn(
      `[code-server-win] registry install of ${registrySpec} failed (${error.message}); ` +
        `retrying from the GitHub release npm artifact`
    )
    runCmdShim('npm', [...baseArgs, releaseSpec], { cwd: workDir })
  }
  const installed = join(workDir, 'node_modules', 'code-server')
  if (!existsSync(installed)) {
    throw new Error('npm install completed but node_modules/code-server is missing')
  }
  return installed
}

function pickFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolvePort(port))
    })
  })
}

function probeHealthz(port) {
  return new Promise((resolveProbe) => {
    const req = get(`http://127.0.0.1:${port}/healthz`, (res) => {
      res.resume()
      resolveProbe(res.statusCode === 200)
    })
    req.on('error', () => resolveProbe(false))
    req.setTimeout(2_000, () => req.destroy())
  })
}

async function smokeTest(rootDir) {
  const nodeExe = join(rootDir, 'lib', 'node.exe')
  const entry = join(rootDir, 'out', 'node', 'entry.js')
  const version = execFileSync(nodeExe, [entry, '--version'], {
    encoding: 'utf8',
    windowsHide: true
  }).trim()
  console.log(`[code-server-win] entry.js reports: ${version.split('\n')[0]}`)

  const port = await pickFreePort()
  const dataDir = join(tmpdir(), `code-server-win-smoke-${port}`)
  const child = spawn(
    nodeExe,
    [
      entry,
      '--bind-addr',
      `127.0.0.1:${port}`,
      '--auth',
      'none',
      '--disable-telemetry',
      '--user-data-dir',
      join(dataDir, 'user-data'),
      '--extensions-dir',
      join(dataDir, 'extensions')
    ],
    { stdio: ['ignore', 'ignore', 'inherit'], windowsHide: true }
  )
  try {
    const deadline = Date.now() + HEALTHZ_TIMEOUT_MS
    let healthy = false
    while (Date.now() < deadline && !healthy) {
      if (child.exitCode !== null) {
        throw new Error(`code-server exited early with code ${child.exitCode}`)
      }
      healthy = await probeHealthz(port)
      if (!healthy) {
        await new Promise((r) => setTimeout(r, HEALTHZ_POLL_MS))
      }
    }
    if (!healthy) {
      throw new Error('code-server never reported healthy — native-module ABI mismatch likely')
    }
    console.log('[code-server-win] /healthz OK — ABI verified end to end')
  } finally {
    if (child.pid) {
      // taskkill /T: the smoke boot forks an extension host that SIGTERM would orphan.
      try {
        execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
      } catch {
        // already gone
      }
    }
    rmSync(dataDir, { recursive: true, force: true })
  }
}

async function main() {
  const outDirFlag = process.argv.indexOf('--out-dir')
  const outDir = resolve(
    outDirFlag === -1 ? join(process.cwd(), 'dist') : process.argv[outDirFlag + 1]
  )
  const pins = loadPins()
  assertRuntimeMatchesPins(pins)

  const workDir = join(tmpdir(), `orca-code-server-win-${pins.codeServerVersion}`)
  rmSync(workDir, { recursive: true, force: true })
  mkdirSync(workDir, { recursive: true })
  console.log(`[code-server-win] building ${pins.assetName} in ${workDir}`)

  const installed = npmInstallCodeServer(pins, workDir)

  const stagingRoot = join(workDir, packageDirName(pins))
  console.log('[code-server-win] assembling package layout')
  cpSync(installed, stagingRoot, { recursive: true, verbatimSymlinks: true })
  cpSync(process.execPath, join(stagingRoot, 'lib', 'node.exe'))

  console.log('[code-server-win] pruning build intermediates')
  const { readdirSync, statSync } = await import('node:fs')
  const stack = [stagingRoot]
  let prunedBytes = 0
  while (stack.length > 0) {
    const dir = stack.pop()
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      const rel = full.slice(stagingRoot.length)
      if (shouldPrune(rel)) {
        try {
          prunedBytes += entry.isDirectory() ? 0 : statSync(full).size
        } catch {
          // best effort accounting
        }
        rmSync(full, { recursive: true, force: true })
      } else if (entry.isDirectory()) {
        stack.push(full)
      }
    }
  }
  console.log(
    `[code-server-win] pruned ~${Math.round(prunedBytes / 1024 / 1024)} MB of intermediates`
  )

  assertPackageLayout(stagingRoot)
  await smokeTest(stagingRoot)

  mkdirSync(outDir, { recursive: true })
  const zipPath = join(outDir, pins.assetName)
  rmSync(zipPath, { force: true })
  console.log('[code-server-win] zipping with System32 tar.exe (bsdtar)')
  const tarExe = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
  execFileSync(tarExe, ['-a', '-cf', zipPath, '-C', workDir, packageDirName(pins)], {
    stdio: 'inherit',
    windowsHide: true
  })

  const sha256 = createHash('sha256').update(readFileSync(zipPath)).digest('hex')
  writeFileSync(`${zipPath}.sha256`, `${sha256}  ${pins.assetName}\n`)
  console.log(`[code-server-win] built ${zipPath}`)
  console.log(`[code-server-win] sha256: ${sha256}`)
  console.log(
    '[code-server-win] pin this hash in config/code-server-windows-package.json and ' +
      'src/main/code-server/code-server-windows-package.ts'
  )
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === import.meta.filename
if (isDirectRun) {
  main().catch((error) => {
    console.error(`[code-server-win] ${error.message}`)
    process.exit(1)
  })
}
