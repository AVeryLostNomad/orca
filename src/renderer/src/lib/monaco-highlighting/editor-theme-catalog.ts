import type { ThemeRegistrationAny } from '@shikijs/core'

type ShikiThemeModule = { default: ThemeRegistrationAny }

export type BundledEditorThemeDescriptor = {
  /** Shiki theme id; doubles as the settings value and Monaco theme name. */
  id: string
  label: string
  kind: 'light' | 'dark'
  loadTheme: () => Promise<ShikiThemeModule>
}

export const DEFAULT_EDITOR_THEME_LIGHT = 'light-plus'
export const DEFAULT_EDITOR_THEME_DARK = 'dark-plus'

export const BUNDLED_EDITOR_THEMES: BundledEditorThemeDescriptor[] = [
  {
    id: 'light-plus',
    label: 'Light+ (VS Code Default)',
    kind: 'light',
    loadTheme: () => import('@shikijs/themes/light-plus')
  },
  {
    id: 'dark-plus',
    label: 'Dark+ (VS Code Default)',
    kind: 'dark',
    loadTheme: () => import('@shikijs/themes/dark-plus')
  },
  {
    id: 'one-dark-pro',
    label: 'One Dark Pro',
    kind: 'dark',
    loadTheme: () => import('@shikijs/themes/one-dark-pro')
  },
  {
    id: 'dracula',
    label: 'Dracula',
    kind: 'dark',
    loadTheme: () => import('@shikijs/themes/dracula')
  },
  {
    id: 'github-dark-default',
    label: 'GitHub Dark',
    kind: 'dark',
    loadTheme: () => import('@shikijs/themes/github-dark-default')
  },
  {
    id: 'github-light-default',
    label: 'GitHub Light',
    kind: 'light',
    loadTheme: () => import('@shikijs/themes/github-light-default')
  },
  {
    id: 'monokai',
    label: 'Monokai',
    kind: 'dark',
    loadTheme: () => import('@shikijs/themes/monokai')
  },
  {
    id: 'solarized-dark',
    label: 'Solarized Dark',
    kind: 'dark',
    loadTheme: () => import('@shikijs/themes/solarized-dark')
  },
  {
    id: 'solarized-light',
    label: 'Solarized Light',
    kind: 'light',
    loadTheme: () => import('@shikijs/themes/solarized-light')
  },
  {
    id: 'nord',
    label: 'Nord',
    kind: 'dark',
    loadTheme: () => import('@shikijs/themes/nord')
  },
  {
    id: 'catppuccin-mocha',
    label: 'Catppuccin Mocha',
    kind: 'dark',
    loadTheme: () => import('@shikijs/themes/catppuccin-mocha')
  },
  {
    id: 'catppuccin-latte',
    label: 'Catppuccin Latte',
    kind: 'light',
    loadTheme: () => import('@shikijs/themes/catppuccin-latte')
  }
]

export function getBundledEditorTheme(id: string): BundledEditorThemeDescriptor | undefined {
  return BUNDLED_EDITOR_THEMES.find((theme) => theme.id === id)
}

export type LocalEditorThemeId = {
  sourceId: string
  extensionFolder: string
  label: string
}

const LOCAL_EDITOR_THEME_PREFIX = 'local:'

export function isLocalEditorThemeId(id: string): boolean {
  return id.startsWith(LOCAL_EDITOR_THEME_PREFIX)
}

export function encodeLocalEditorThemeId(id: LocalEditorThemeId): string {
  return [
    LOCAL_EDITOR_THEME_PREFIX.slice(0, -1),
    encodeURIComponent(id.sourceId),
    encodeURIComponent(id.extensionFolder),
    encodeURIComponent(id.label)
  ].join(':')
}

export function decodeLocalEditorThemeId(encoded: string): LocalEditorThemeId | undefined {
  if (!isLocalEditorThemeId(encoded)) {
    return undefined
  }
  const parts = encoded.split(':')
  if (parts.length !== 4) {
    return undefined
  }
  try {
    return {
      sourceId: decodeURIComponent(parts[1]),
      extensionFolder: decodeURIComponent(parts[2]),
      label: decodeURIComponent(parts[3])
    }
  } catch {
    return undefined
  }
}

// Monaco theme names only allow word characters and dashes; local theme ids
// carry arbitrary labels, so each applied theme gets a stable slug.
export function monacoThemeNameForEditorTheme(id: string): string {
  if (!isLocalEditorThemeId(id)) {
    return id
  }
  let hash = 0
  for (let index = 0; index < id.length; index++) {
    hash = (hash * 31 + id.charCodeAt(index)) | 0
  }
  return `orca-local-theme-${(hash >>> 0).toString(36)}`
}
