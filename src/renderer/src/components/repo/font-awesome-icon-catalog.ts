import { useEffect, useSyncExternalStore } from 'react'
import type { IconDefinition, IconPack } from '@fortawesome/free-solid-svg-icons'
import type { FontAwesomeIconStyle } from '../../../../shared/repo-icon'

export type FontAwesomeIconEntry = {
  style: FontAwesomeIconStyle
  name: string
  /** Lowercased alias names (e.g. `home` for `house`) used for search only. */
  aliases: readonly string[]
  definition: IconDefinition
}

export const FONT_AWESOME_ICON_STYLES: readonly FontAwesomeIconStyle[] = [
  'solid',
  'regular',
  'brands'
]

// Why: each pack is a ~1MB single module, so they load on demand and stay out
// of the main renderer chunk unless a Font Awesome icon actually renders.
const packLoaders: Record<FontAwesomeIconStyle, () => Promise<IconPack>> = {
  solid: () => import('@fortawesome/free-solid-svg-icons').then((module) => module.fas),
  regular: () => import('@fortawesome/free-regular-svg-icons').then((module) => module.far),
  brands: () => import('@fortawesome/free-brands-svg-icons').then((module) => module.fab)
}

const loadedPacks = new Map<FontAwesomeIconStyle, Map<string, IconDefinition>>()
const pendingPacks = new Map<FontAwesomeIconStyle, Promise<Map<string, IconDefinition>>>()
const listeners = new Set<() => void>()

function notifyPackListeners(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function loadFontAwesomePack(
  style: FontAwesomeIconStyle
): Promise<Map<string, IconDefinition>> {
  const loaded = loadedPacks.get(style)
  if (loaded) {
    return Promise.resolve(loaded)
  }
  const pending = pendingPacks.get(style)
  if (pending) {
    return pending
  }
  const promise = packLoaders[style]()
    .then((pack) => {
      const byName = new Map<string, IconDefinition>()
      for (const definition of Object.values(pack)) {
        byName.set(definition.iconName, definition)
      }
      loadedPacks.set(style, byName)
      notifyPackListeners()
      return byName
    })
    .finally(() => {
      pendingPacks.delete(style)
    })
  pendingPacks.set(style, promise)
  return promise
}

export function getLoadedFontAwesomeIcon(
  style: FontAwesomeIconStyle,
  name: string
): IconDefinition | null {
  return loadedPacks.get(style)?.get(name) ?? null
}

function subscribeFontAwesomePacks(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Resolves a Font Awesome definition, loading its pack on first use. */
export function useFontAwesomeIcon(
  style: FontAwesomeIconStyle,
  name: string
): IconDefinition | null {
  const definition = useSyncExternalStore(subscribeFontAwesomePacks, () =>
    getLoadedFontAwesomeIcon(style, name)
  )
  useEffect(() => {
    if (!loadedPacks.has(style)) {
      // Why: a failed chunk load is surfaced by the fallback glyph, not a toast.
      void loadFontAwesomePack(style).catch(() => undefined)
    }
  }, [style])
  return definition
}

let catalogPromise: Promise<readonly FontAwesomeIconEntry[]> | null = null

export function loadFontAwesomeCatalog(): Promise<readonly FontAwesomeIconEntry[]> {
  if (!catalogPromise) {
    catalogPromise = Promise.all(
      FONT_AWESOME_ICON_STYLES.map((style) => loadFontAwesomePack(style))
    )
      .then((packs) => buildFontAwesomeCatalog(packs))
      .catch((error: unknown) => {
        catalogPromise = null
        throw error
      })
  }
  return catalogPromise
}

export function buildFontAwesomeCatalog(
  packs: readonly Map<string, IconDefinition>[]
): FontAwesomeIconEntry[] {
  const entries: FontAwesomeIconEntry[] = []
  packs.forEach((pack, index) => {
    const style = FONT_AWESOME_ICON_STYLES[index]!
    for (const definition of pack.values()) {
      entries.push({
        style,
        name: definition.iconName,
        aliases: (definition.icon[2] ?? [])
          .filter((alias): alias is string => typeof alias === 'string')
          .map((alias) => alias.toLowerCase()),
        definition
      })
    }
  })
  return entries.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Ranks name-prefix matches ahead of substring and alias matches so `code`
 * surfaces `code` before `barcode`. Every query token must match.
 */
export function searchFontAwesomeIcons(
  entries: readonly FontAwesomeIconEntry[],
  query: string,
  limit: number
): FontAwesomeIconEntry[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) {
    return entries.slice(0, limit)
  }
  const ranked: { entry: FontAwesomeIconEntry; rank: number }[] = []
  for (const entry of entries) {
    const rank = rankFontAwesomeEntry(entry, tokens)
    if (rank !== null) {
      ranked.push({ entry, rank })
    }
  }
  return ranked
    .sort((a, b) => a.rank - b.rank || a.entry.name.localeCompare(b.entry.name))
    .slice(0, limit)
    .map((match) => match.entry)
}

function rankFontAwesomeEntry(entry: FontAwesomeIconEntry, tokens: string[]): number | null {
  let rank = 0
  for (const token of tokens) {
    if (entry.name === token) {
      continue
    }
    if (entry.name.startsWith(token)) {
      rank += 1
    } else if (entry.name.includes(token)) {
      rank += 2
    } else if (entry.aliases.some((alias) => alias.includes(token))) {
      rank += 3
    } else {
      return null
    }
  }
  return rank
}
