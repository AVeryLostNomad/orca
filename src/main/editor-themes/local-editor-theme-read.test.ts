import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readLocalEditorTheme } from './local-editor-theme-read'
import { scanLocalEditorThemes } from './local-editor-theme-scan'

let homeDir: string
const deps = (): { homeDir: string } => ({ homeDir })

async function writeExtension(
  folder: string,
  packageJson: unknown,
  themeFiles: Record<string, unknown> = {}
): Promise<string> {
  const extensionDir = join(homeDir, '.vscode', 'extensions', folder)
  await mkdir(join(extensionDir, 'themes'), { recursive: true })
  await writeFile(join(extensionDir, 'package.json'), JSON.stringify(packageJson))
  for (const [relativePath, content] of Object.entries(themeFiles)) {
    await writeFile(
      join(extensionDir, relativePath),
      typeof content === 'string' ? content : JSON.stringify(content)
    )
  }
  return extensionDir
}

beforeEach(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'orca-editor-theme-test-'))
})

afterEach(async () => {
  await rm(homeDir, { recursive: true, force: true })
})

describe('scanLocalEditorThemes', () => {
  it('lists theme contributions with source and extension metadata', async () => {
    await writeExtension('pub.mytheme-1.0.0', {
      displayName: 'My Theme Pack',
      contributes: {
        themes: [
          { label: 'My Dark', uiTheme: 'vs-dark', path: './themes/dark.json' },
          { label: 'My Light', uiTheme: 'vs', path: './themes/light.json' },
          { label: 'Old TmTheme', uiTheme: 'vs', path: './themes/old.tmTheme' }
        ]
      }
    })
    const themes = await scanLocalEditorThemes(deps())
    expect(themes).toHaveLength(2)
    expect(themes[0]).toMatchObject({
      sourceId: 'vscode',
      sourceName: 'VS Code',
      extensionFolder: 'pub.mytheme-1.0.0',
      extensionDisplayName: 'My Theme Pack',
      label: 'My Dark',
      uiTheme: 'vs-dark'
    })
  })

  it('skips extensions with malformed package.json', async () => {
    const extensionDir = join(homeDir, '.vscode', 'extensions', 'pub.broken-1.0.0')
    await mkdir(extensionDir, { recursive: true })
    await writeFile(join(extensionDir, 'package.json'), '{not json')
    expect(await scanLocalEditorThemes(deps())).toEqual([])
  })

  it('returns empty when no editor is installed', async () => {
    expect(await scanLocalEditorThemes(deps())).toEqual([])
  })
})

describe('readLocalEditorTheme', () => {
  const packageJson = {
    contributes: {
      themes: [{ label: 'My Dark', uiTheme: 'vs-dark', path: './themes/dark.json' }]
    }
  }

  it('parses JSONC and flattens the include chain child-over-parent', async () => {
    await writeExtension('pub.mytheme-1.0.0', packageJson, {
      'themes/dark.json': `{
        // JSONC comment
        "name": "My Dark",
        "include": "./base.json",
        "colors": { "editor.background": "#111111" },
        "tokenColors": [{ "scope": "comment", "settings": { "foreground": "#00ff00" } }],
      }`,
      'themes/base.json': {
        type: 'dark',
        colors: { 'editor.background': '#000000', 'editor.foreground': '#eeeeee' },
        tokenColors: [{ scope: 'string', settings: { foreground: '#ff0000' } }]
      }
    })
    const theme = await readLocalEditorTheme(
      { sourceId: 'vscode', extensionFolder: 'pub.mytheme-1.0.0', label: 'My Dark' },
      deps()
    )
    expect(theme.type).toBe('dark')
    expect(theme.colors).toMatchObject({
      'editor.background': '#111111',
      'editor.foreground': '#eeeeee'
    })
    expect(theme.tokenColors?.map((entry) => entry.scope)).toEqual(['string', 'comment'])
  })

  it('falls back to the contribution uiTheme when the file has no type', async () => {
    await writeExtension(
      'pub.light-1.0.0',
      {
        contributes: {
          themes: [{ label: 'Lite', uiTheme: 'vs', path: './themes/lite.json' }]
        }
      },
      { 'themes/lite.json': { colors: {} } }
    )
    const theme = await readLocalEditorTheme(
      { sourceId: 'vscode', extensionFolder: 'pub.light-1.0.0', label: 'Lite' },
      deps()
    )
    expect(theme.type).toBe('light')
  })

  it('rejects includes that escape the extension directory', async () => {
    await writeExtension('pub.evil-1.0.0', {
      contributes: {
        themes: [{ label: 'Evil', uiTheme: 'vs-dark', path: './themes/evil.json' }]
      }
    })
    await writeFile(
      join(homeDir, '.vscode', 'extensions', 'pub.evil-1.0.0', 'themes', 'evil.json'),
      JSON.stringify({ include: '../../../../outside.json' })
    )
    await expect(
      readLocalEditorTheme(
        { sourceId: 'vscode', extensionFolder: 'pub.evil-1.0.0', label: 'Evil' },
        deps()
      )
    ).rejects.toThrow('escapes the extension directory')
  })

  it('rejects path-traversal extension folder names', async () => {
    await expect(
      readLocalEditorTheme(
        { sourceId: 'vscode', extensionFolder: '../outside', label: 'X' },
        deps()
      )
    ).rejects.toThrow('Invalid extension folder name')
  })

  it('rejects unknown sources and missing labels', async () => {
    await writeExtension('pub.mytheme-1.0.0', packageJson, {
      'themes/dark.json': { type: 'dark' }
    })
    await expect(
      readLocalEditorTheme(
        { sourceId: 'not-an-editor', extensionFolder: 'pub.mytheme-1.0.0', label: 'My Dark' },
        deps()
      )
    ).rejects.toThrow('Unknown editor theme source')
    await expect(
      readLocalEditorTheme(
        { sourceId: 'vscode', extensionFolder: 'pub.mytheme-1.0.0', label: 'Nope' },
        deps()
      )
    ).rejects.toThrow('not found in extension')
  })

  it('rejects include chains that are too deep', async () => {
    const chain: Record<string, unknown> = {}
    for (let index = 0; index <= 6; index++) {
      chain[`themes/theme-${index}.json`] =
        index === 6 ? { type: 'dark' } : { include: `./theme-${index + 1}.json` }
    }
    await writeExtension(
      'pub.deep-1.0.0',
      {
        contributes: {
          themes: [{ label: 'Deep', uiTheme: 'vs-dark', path: './themes/theme-0.json' }]
        }
      },
      chain
    )
    await expect(
      readLocalEditorTheme(
        { sourceId: 'vscode', extensionFolder: 'pub.deep-1.0.0', label: 'Deep' },
        deps()
      )
    ).rejects.toThrow('too deep')
  })
})
