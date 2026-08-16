import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { extensionsDirMock, sourceDirMock } = vi.hoisted(() => ({
  extensionsDirMock: vi.fn<() => string>(),
  sourceDirMock: vi.fn<() => string | null>()
}))

vi.mock('./code-server-paths', () => ({
  getCodeServerExtensionsDir: extensionsDirMock
}))
vi.mock('./code-server-import-sources', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveEditorExtensionsDir: sourceDirMock
}))

import {
  extensionIdFromFolderName,
  importExtensionsFromEditor,
  mergeExtensionsMetadata,
  type ExtensionsMetadataEntry
} from './code-server-extension-import'

describe('extensionIdFromFolderName', () => {
  it('strips the version and optional platform suffix', () => {
    expect(extensionIdFromFolderName('anthropic.claude-code-2.1.233-darwin-arm64')).toBe(
      'anthropic.claude-code'
    )
    expect(extensionIdFromFolderName('angular.ng-template-22.0.1-universal')).toBe(
      'angular.ng-template'
    )
  })

  it('lowercases the id the way VS Code compares them', () => {
    expect(extensionIdFromFolderName('MS-Python.python-2026.1.0')).toBe('ms-python.python')
  })
})

describe('mergeExtensionsMetadata', () => {
  const entry = (id: string, version: string): ExtensionsMetadataEntry => ({
    identifier: { id },
    version
  })

  it('replaces existing entries for the same id and keeps the rest', () => {
    const merged = mergeExtensionsMetadata(
      [entry('a.one', '1.0.0'), entry('b.two', '1.0.0')],
      [entry('A.One', '2.0.0')]
    )
    expect(merged).toEqual([entry('b.two', '1.0.0'), entry('A.One', '2.0.0')])
  })
})

describe('importExtensionsFromEditor', () => {
  let sourceDir: string
  let targetDir: string

  async function writeExtension(root: string, folder: string, manifest: object): Promise<void> {
    await mkdir(join(root, folder), { recursive: true })
    await writeFile(join(root, folder, 'package.json'), JSON.stringify(manifest))
  }

  beforeEach(async () => {
    sourceDir = await mkdtemp(join(tmpdir(), 'orca-ext-src-'))
    targetDir = join(await mkdtemp(join(tmpdir(), 'orca-ext-dst-')), 'extensions')
    sourceDirMock.mockReturnValue(sourceDir)
    extensionsDirMock.mockReturnValue(targetDir)
  })

  afterEach(async () => {
    await rm(sourceDir, { recursive: true, force: true })
    await rm(targetDir, { recursive: true, force: true })
  })

  it('copies extensions, rewrites metadata locations, and skips obsolete ones', async () => {
    await writeExtension(sourceDir, 'pub.alive-1.0.0', {
      publisher: 'pub',
      name: 'alive',
      version: '1.0.0'
    })
    await writeExtension(sourceDir, 'pub.dead-1.0.0', {
      publisher: 'pub',
      name: 'dead',
      version: '1.0.0'
    })
    await writeFile(join(sourceDir, '.obsolete'), JSON.stringify({ 'pub.dead-1.0.0': true }))
    await writeFile(
      join(sourceDir, 'extensions.json'),
      JSON.stringify([
        {
          identifier: { id: 'pub.alive' },
          version: '1.0.0',
          location: { $mid: 1, path: join(sourceDir, 'pub.alive-1.0.0'), scheme: 'file' },
          relativeLocation: 'pub.alive-1.0.0',
          metadata: { pinned: true }
        }
      ])
    )

    const summary = await importExtensionsFromEditor('vscode')

    expect(summary).toEqual({ imported: 1, skipped: 0 })
    expect(existsSync(join(targetDir, 'pub.alive-1.0.0', 'package.json'))).toBe(true)
    expect(existsSync(join(targetDir, 'pub.dead-1.0.0'))).toBe(false)
    const metadata = JSON.parse(await readFile(join(targetDir, 'extensions.json'), 'utf8'))
    expect(metadata).toHaveLength(1)
    expect(metadata[0].location.path).toBe(join(targetDir, 'pub.alive-1.0.0'))
    expect(metadata[0].metadata).toEqual({ pinned: true })
  })

  it('skips extensions already installed in the embedded editor (any version)', async () => {
    await writeExtension(sourceDir, 'pub.tool-1.0.0', {
      publisher: 'pub',
      name: 'tool',
      version: '1.0.0'
    })
    await mkdir(join(targetDir, 'pub.tool-2.0.0'), { recursive: true })

    const summary = await importExtensionsFromEditor('vscode')

    expect(summary).toEqual({ imported: 0, skipped: 1 })
    expect(existsSync(join(targetDir, 'pub.tool-1.0.0'))).toBe(false)
  })

  it('synthesizes metadata from the manifest when the source has no extensions.json', async () => {
    await writeExtension(sourceDir, 'pub.solo-3.2.1', {
      publisher: 'pub',
      name: 'solo',
      version: '3.2.1'
    })

    const summary = await importExtensionsFromEditor('vscode')

    expect(summary).toEqual({ imported: 1, skipped: 0 })
    const metadata = JSON.parse(await readFile(join(targetDir, 'extensions.json'), 'utf8'))
    expect(metadata[0].identifier.id).toBe('pub.solo')
    expect(metadata[0].version).toBe('3.2.1')
    expect(metadata[0].relativeLocation).toBe('pub.solo-3.2.1')
  })

  it('returns zero counts when the source editor has no extensions dir', async () => {
    sourceDirMock.mockReturnValue(null)
    await expect(importExtensionsFromEditor('cursor')).resolves.toEqual({
      imported: 0,
      skipped: 0
    })
  })
})
