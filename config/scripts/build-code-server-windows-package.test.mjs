import { describe, expect, it } from 'vitest'
import {
  assertPackageLayout,
  assertRuntimeMatchesPins,
  hasUnsafeCmdArg,
  loadPins,
  packageDirName,
  shouldPrune
} from './build-code-server-windows-package.mjs'

describe('build-code-server-windows-package helpers', () => {
  it('loads the real pin file and derives the package dir name from it', () => {
    const pins = loadPins()
    expect(pins.assetName).toBe(`code-server-${pins.codeServerVersion}-windows-amd64.zip`)
    expect(packageDirName(pins)).toBe(`code-server-${pins.codeServerVersion}-windows-amd64`)
    expect(pins.nodeVersion).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('rejects a runtime that does not match the ABI pins', () => {
    const pins = { nodeVersion: '22.23.2' }
    const ok = { platform: 'win32', arch: 'x64', version: 'v22.23.2' }
    expect(() => assertRuntimeMatchesPins(pins, ok)).not.toThrow()
    expect(() => assertRuntimeMatchesPins(pins, { ...ok, platform: 'linux' })).toThrow(/win32/)
    expect(() => assertRuntimeMatchesPins(pins, { ...ok, arch: 'arm64' })).toThrow(/x64/)
    expect(() => assertRuntimeMatchesPins(pins, { ...ok, version: 'v22.9.0' })).toThrow(/ABI/)
  })

  it('flags cmd.exe metacharacters that could escape npm.cmd argv', () => {
    for (const bad of ['a&b', 'a|b', 'a%PATH%b', 'a^b', 'a"b', 'a!b', 'a<b', 'a>b', 'a\r\nb']) {
      expect(hasUnsafeCmdArg(bad)).toBe(true)
    }
    // Parens stay allowed: C:\Program Files (x86)\... is a legitimate path.
    expect(hasUnsafeCmdArg('C:\\Program Files (x86)\\nodejs')).toBe(false)
    expect(hasUnsafeCmdArg('code-server@4.127.0')).toBe(false)
  })

  it('prunes gyp intermediates but keeps built .node artifacts', () => {
    expect(shouldPrune('/node_modules/x/build/Release/native.node')).toBe(false)
    expect(shouldPrune('\\node_modules\\x\\build\\Release\\native.node')).toBe(false)
    expect(shouldPrune('/node_modules/x/build/obj/native.obj')).toBe(true)
    expect(shouldPrune('/node_modules/x/build/binding.vcxproj')).toBe(true)
    expect(shouldPrune('/node_modules/x/build/config.gypi')).toBe(true)
    expect(shouldPrune('/node_modules/.bin/rimraf.cmd')).toBe(true)
    expect(shouldPrune('/out/node/entry.js')).toBe(false)
    expect(shouldPrune('/lib/vscode/product.json')).toBe(false)
  })

  it('validates the assembled layout by its load-bearing files', () => {
    const present = new Set([
      '/pkg/lib/node.exe',
      '/pkg/out/node/entry.js',
      '/pkg/lib/vscode/product.json',
      '/pkg/package.json'
    ])
    const exists = (p) => present.has(p.replace(/\\/g, '/'))
    expect(() => assertPackageLayout('/pkg', exists)).not.toThrow()
    present.delete('/pkg/lib/node.exe')
    expect(() => assertPackageLayout('/pkg', exists)).toThrow(/node\.exe/)
  })
})
