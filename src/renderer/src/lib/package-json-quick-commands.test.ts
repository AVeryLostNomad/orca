import { describe, expect, it } from 'vitest'
import {
  buildLockfileManagerIndex,
  buildPackageScriptQuickCommands,
  comparePackageJsonPaths,
  isPackageJsonPath
} from './package-json-quick-commands'

const manifest = JSON.stringify({
  name: 'procedural-dude',
  scripts: {
    dev: 'vite',
    build: 'vite build',
    preview: 'vite preview',
    assets: 'node tools/assets.mjs'
  }
})

describe('package-json quick commands', () => {
  it('turns every root script into an npm run command', () => {
    const commands = buildPackageScriptQuickCommands({
      packageJsonPath: 'package.json',
      content: manifest,
      lockfiles: new Map(),
      rootPackageManager: null
    })
    expect(commands.map((c) => [c.command.label, c.command.command])).toEqual([
      ['dev', 'npm run dev'],
      ['build', 'npm run build'],
      ['preview', 'npm run preview'],
      ['assets', 'npm run assets']
    ])
    expect(new Set(commands.map((c) => c.command.id)).size).toBe(4)
  })

  it('targets nested packages and picks the nearest lockfile manager', () => {
    const lockfiles = buildLockfileManagerIndex(['pnpm-lock.yaml', 'apps/web/yarn.lock'])
    const nested = buildPackageScriptQuickCommands({
      packageJsonPath: 'apps/web/package.json',
      content: manifest,
      lockfiles,
      rootPackageManager: null
    })
    expect(nested[0].command.command).toBe('yarn --cwd apps/web run dev')
    const other = buildPackageScriptQuickCommands({
      packageJsonPath: 'packages/my lib/package.json',
      content: manifest,
      lockfiles,
      rootPackageManager: null
    })
    expect(other[0].command.command).toBe('pnpm --dir "packages/my lib" run dev')
  })

  it('honors the packageManager field', () => {
    const commands = buildPackageScriptQuickCommands({
      packageJsonPath: 'package.json',
      content: JSON.stringify({ packageManager: 'bun@1.1.0', scripts: { dev: 'x' } }),
      lockfiles: new Map(),
      rootPackageManager: null
    })
    expect(commands[0].command.command).toBe('bun run dev')
  })

  it('ignores invalid manifests and node_modules', () => {
    expect(
      buildPackageScriptQuickCommands({
        packageJsonPath: 'package.json',
        content: '{ nope',
        lockfiles: new Map(),
        rootPackageManager: null
      })
    ).toEqual([])
    expect(isPackageJsonPath('node_modules/vite/package.json')).toBe(false)
    expect(isPackageJsonPath('apps\\web\\package.json')).toBe(true)
    expect(isPackageJsonPath('package.json.bak')).toBe(false)
  })

  it('sorts the root package first', () => {
    expect(
      ['b/package.json', 'package.json', 'a/c/package.json'].sort(comparePackageJsonPaths)
    ).toEqual(['package.json', 'b/package.json', 'a/c/package.json'])
  })
})
