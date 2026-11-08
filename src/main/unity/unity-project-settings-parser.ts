import { basename, extname } from 'node:path'

// Unity's serializer emits a fixed YAML subset (`%TAG !u!`, `--- !u!78 &1` headers) that
// general YAML parsers reject, so settings files are read with a targeted line parser.

type UnitySequenceItem = string | Record<string, string>

const BUILT_IN_TAGS = [
  'Untagged',
  'Respawn',
  'Finish',
  'EditorOnly',
  'MainCamera',
  'Player',
  'GameController'
]

const BUILT_IN_LAYERS: { index: number; name: string }[] = [
  { index: 0, name: 'Default' },
  { index: 1, name: 'TransparentFX' },
  { index: 2, name: 'Ignore Raycast' },
  { index: 4, name: 'Water' },
  { index: 5, name: 'UI' }
]

const MAPPING_ENTRY = /^([\w.]+):(?:\s+(.*))?$/

/** Binary-serialized assets (Asset Serialization: Force Binary) carry no YAML header. */
export function isTextSerializedAsset(text: string): boolean {
  return text.startsWith('%YAML')
}

function unquoteScalar(raw: string): string {
  const value = raw.trim()
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("''", "'")
  }
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\(["\\])/g, '$1')
  }
  return value
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length
}

/** Items of the block sequence under the first `key:` line; Unity writes items at the key's own indent. */
function readSequence(lines: string[], key: string): UnitySequenceItem[] {
  const keyIndex = lines.findIndex((line) => line.trimStart().startsWith(`${key}:`))
  if (keyIndex === -1) {
    return []
  }
  const keyLine = lines[keyIndex]
  const inline = keyLine.slice(keyLine.indexOf(':') + 1).trim()
  if (inline.startsWith('[')) {
    return inline
      .slice(1, inline.lastIndexOf(']'))
      .split(',')
      .map(unquoteScalar)
      .filter((value) => value.length > 0)
  }
  const keyIndent = indentOf(keyLine)
  const items: UnitySequenceItem[] = []
  let itemIndent = -1
  let current: Record<string, string> | null = null
  for (const line of lines.slice(keyIndex + 1)) {
    if (line.trim() === '') {
      continue
    }
    const indent = indentOf(line)
    const body = line.trimStart()
    if (itemIndent < 0) {
      if (indent < keyIndent || !body.startsWith('-')) {
        return items
      }
      itemIndent = indent
    }
    if (indent < itemIndent || (indent === itemIndent && !body.startsWith('-'))) {
      break
    }
    if (indent === itemIndent) {
      const rest = body.slice(1).trim()
      const entry = MAPPING_ENTRY.exec(rest)
      if (entry) {
        current = { [entry[1]]: unquoteScalar(entry[2] ?? '') }
        items.push(current)
      } else {
        current = null
        items.push(unquoteScalar(rest))
      }
      continue
    }
    const entry = current && indent === itemIndent + 2 ? MAPPING_ENTRY.exec(body) : null
    if (current && entry) {
      current[entry[1]] = unquoteScalar(entry[2] ?? '')
    }
  }
  return items
}

export function parseProjectVersion(text: string): string | null {
  return /^m_EditorVersion:\s*(\S+)/m.exec(text)?.[1] ?? null
}

export function parseTagManager(text: string | null): {
  tags: string[]
  layers: { index: number; name: string }[]
  sortingLayers: string[]
} {
  if (text === null || !isTextSerializedAsset(text)) {
    return { tags: [...BUILT_IN_TAGS], layers: [...BUILT_IN_LAYERS], sortingLayers: ['Default'] }
  }
  const lines = text.split(/\r?\n/)
  const userTags = readSequence(lines, 'tags').filter(
    (item): item is string => typeof item === 'string' && item.length > 0
  )
  const layerNames = readSequence(lines, 'layers')
  const layers = layerNames.flatMap((item, index) =>
    typeof item === 'string' && item.length > 0 ? [{ index, name: item }] : []
  )
  const sortingLayers = readSequence(lines, 'm_SortingLayers').flatMap((item) =>
    typeof item === 'object' && item.name ? [item.name] : []
  )
  return {
    tags: [...new Set([...BUILT_IN_TAGS, ...userTags])],
    layers: layers.length > 0 ? layers : [...BUILT_IN_LAYERS],
    sortingLayers: sortingLayers.length > 0 ? sortingLayers : ['Default']
  }
}

export function parseBuildSettingsScenes(
  text: string | null
): { path: string; name: string; enabled: boolean }[] {
  if (text === null || !isTextSerializedAsset(text)) {
    return []
  }
  return readSequence(text.split(/\r?\n/), 'm_Scenes').flatMap((item) =>
    typeof item === 'object' && item.path
      ? [
          {
            path: item.path,
            name: basename(item.path, extname(item.path)),
            enabled: item.enabled !== '0'
          }
        ]
      : []
  )
}

export function parseInputManagerAxes(text: string | null): string[] {
  if (text === null || !isTextSerializedAsset(text)) {
    return []
  }
  const names = readSequence(text.split(/\r?\n/), 'm_Axes').flatMap((item) =>
    typeof item === 'object' && item.m_Name ? [item.m_Name] : []
  )
  return [...new Set(names)]
}

/** Version spec of com.unity.pipeline in Packages/manifest.json (may be a semver, git URL or file: path). */
export function parsePipelinePackage(manifestText: string | null): {
  installed: boolean
  version: string | null
} {
  if (manifestText === null) {
    return { installed: false, version: null }
  }
  try {
    const manifest: unknown = JSON.parse(manifestText)
    const dependencies =
      manifest && typeof manifest === 'object' && 'dependencies' in manifest
        ? manifest.dependencies
        : null
    const version =
      dependencies && typeof dependencies === 'object' && 'com.unity.pipeline' in dependencies
        ? dependencies['com.unity.pipeline']
        : undefined
    return typeof version === 'string'
      ? { installed: true, version }
      : { installed: false, version: null }
  } catch {
    return { installed: false, version: null }
  }
}
