import { describe, expect, it } from 'vitest'
import {
  parseBuildSettingsScenes,
  parseInputManagerAxes,
  parseTagManager
} from './unity-project-settings-parser'

const TAG_MANAGER = `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!78 &1
TagManager:
  serializedVersion: 2
  tags:
  - Enemy
  - 'It''s: quoted'
  layers:
  - Default
  - TransparentFX
  - Ignore Raycast
  - 
  - Water
  - UI
  - 
  - 
  - "Ground"
  m_SortingLayers:
  - name: Default
    uniqueID: 0
    locked: 0
  - name: Foreground
    uniqueID: 1234
    locked: 0
  m_RenderingLayers:
  - Default
`

describe('parseTagManager', () => {
  it('keeps layer indices across empty slots and unquotes scalars', () => {
    const parsed = parseTagManager(TAG_MANAGER)
    expect(parsed.layers).toEqual([
      { index: 0, name: 'Default' },
      { index: 1, name: 'TransparentFX' },
      { index: 2, name: 'Ignore Raycast' },
      { index: 4, name: 'Water' },
      { index: 5, name: 'UI' },
      { index: 8, name: 'Ground' }
    ])
    expect(parsed.tags.slice(-2)).toEqual(['Enemy', "It's: quoted"])
    expect(parsed.sortingLayers).toEqual(['Default', 'Foreground'])
  })

  it('reads an inline empty tag list and falls back to built-ins for binary assets', () => {
    const inline = parseTagManager(
      TAG_MANAGER.replace(/ {2}tags:\n(?: {2}- .*\n)+/, '  tags: []\n')
    )
    expect(inline.tags).toHaveLength(7)
    const binary = parseTagManager('\u0000\u0000binary')
    expect(binary.layers.map((layer) => layer.index)).toEqual([0, 1, 2, 4, 5])
  })
})

describe('build settings and input axes', () => {
  it('reads scene maps regardless of key order and dedupes axis names', () => {
    const scenes = parseBuildSettingsScenes(`%YAML 1.1
--- !u!1045 &1
EditorBuildSettings:
  m_Scenes:
  - enabled: 1
    path: Assets/Scenes/Main.unity
    guid: 99c9720ab356a0642a771bea13969a05
  - path: Assets/Levels/Boss Fight.unity
    enabled: 0
  m_configObjects: {}
`)
    expect(scenes).toEqual([
      { path: 'Assets/Scenes/Main.unity', name: 'Main', enabled: true },
      { path: 'Assets/Levels/Boss Fight.unity', name: 'Boss Fight', enabled: false }
    ])
    const axes = parseInputManagerAxes(`%YAML 1.1
--- !u!13 &1
InputManager:
  m_Axes:
  - serializedVersion: 3
    m_Name: Horizontal
    descriptiveName: 
  - serializedVersion: 3
    m_Name: Horizontal
  - serializedVersion: 3
    m_Name: Fire1
`)
    expect(axes).toEqual(['Horizontal', 'Fire1'])
  })
})
