import { describe, expect, it } from 'vitest'
import {
  BUNDLED_EDITOR_THEMES,
  DEFAULT_EDITOR_THEME_DARK,
  DEFAULT_EDITOR_THEME_LIGHT,
  decodeLocalEditorThemeId,
  encodeLocalEditorThemeId,
  getBundledEditorTheme,
  isLocalEditorThemeId,
  monacoThemeNameForEditorTheme
} from './editor-theme-catalog'

describe('editor theme catalog', () => {
  it('defaults exist in the bundled list with matching kinds', () => {
    expect(getBundledEditorTheme(DEFAULT_EDITOR_THEME_LIGHT)?.kind).toBe('light')
    expect(getBundledEditorTheme(DEFAULT_EDITOR_THEME_DARK)?.kind).toBe('dark')
  })

  it('bundled theme ids are unique and Monaco-name safe', () => {
    const ids = BUNDLED_EDITOR_THEMES.map((theme) => theme.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9-]+$/)
      expect(monacoThemeNameForEditorTheme(id)).toBe(id)
    }
  })

  it('round-trips local ids with separators and spaces in every part', () => {
    const id = {
      sourceId: 'vscode-insiders',
      extensionFolder: 'pub.name-1.2.3',
      label: 'Monokai: Classic (Dark)'
    }
    const encoded = encodeLocalEditorThemeId(id)
    expect(isLocalEditorThemeId(encoded)).toBe(true)
    expect(decodeLocalEditorThemeId(encoded)).toEqual(id)
  })

  it('rejects malformed local ids instead of throwing', () => {
    expect(decodeLocalEditorThemeId('local:only-two:parts')).toBeUndefined()
    expect(decodeLocalEditorThemeId('dark-plus')).toBeUndefined()
    expect(decodeLocalEditorThemeId('local:a:b:c:d')).toBeUndefined()
    expect(decodeLocalEditorThemeId('local:%FF:b:c')).toBeUndefined()
  })

  it('maps local ids to stable slug-safe Monaco theme names', () => {
    const encoded = encodeLocalEditorThemeId({
      sourceId: 'vscode',
      extensionFolder: 'pub.theme-1.0.0',
      label: 'Theme With Spaces'
    })
    const name = monacoThemeNameForEditorTheme(encoded)
    expect(name).toMatch(/^orca-local-theme-[a-z0-9]+$/)
    expect(monacoThemeNameForEditorTheme(encoded)).toBe(name)
  })
})
