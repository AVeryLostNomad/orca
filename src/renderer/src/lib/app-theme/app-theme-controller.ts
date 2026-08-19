import { useAppStore } from '@/store'
import {
  decodeLocalEditorThemeId,
  getBundledEditorTheme,
  isLocalEditorThemeId
} from '@/lib/monaco-highlighting/editor-theme-catalog'
import { runWithThemeTransitionsDisabled } from '@/lib/document-theme'
import { buildAppThemeTokenOverrides, type AppThemeSource } from './app-theme-token-map'
import { buildAppThemeTerminalTheme } from './app-theme-terminal-theme'

export const DEFAULT_APP_THEME = 'default'

let controllerStarted = false
let applyGeneration = 0
// Tracks exactly which properties this controller set so 'default' (and theme
// switches) clear only its own overrides — never --editor-surface or fonts.
let appliedTokenNames: string[] = []
let appliedAppThemeId: string | undefined
// Mode matters beyond the id: the terminal override is published per-mode.
let appliedIsDark: boolean | undefined

function prefersDarkQuery(): MediaQueryList {
  return window.matchMedia('(prefers-color-scheme: dark)')
}

type ThemeMode = 'system' | 'dark' | 'light'

function resolveIsDark(theme: ThemeMode): boolean {
  return theme === 'dark' || (theme === 'system' && prefersDarkQuery().matches)
}

function selectedAppThemeId(): string {
  const settings = useAppStore.getState().settings
  const isDark = resolveIsDark(settings?.theme ?? 'system')
  const id = isDark ? settings?.appThemeDark : settings?.appThemeLight
  return id || DEFAULT_APP_THEME
}

function clearAppliedTokens(): void {
  if (appliedTokenNames.length === 0) {
    appliedAppThemeId = DEFAULT_APP_THEME
    return
  }
  const root = document.documentElement
  runWithThemeTransitionsDisabled(() => {
    for (const name of appliedTokenNames) {
      root.style.removeProperty(name)
    }
  })
  appliedTokenNames = []
  appliedAppThemeId = DEFAULT_APP_THEME
}

async function loadAppThemeSource(id: string): Promise<AppThemeSource> {
  if (isLocalEditorThemeId(id)) {
    const localId = decodeLocalEditorThemeId(id)
    if (!localId) {
      throw new Error(`Malformed app theme id: ${id}`)
    }
    const theme = await window.api.editorThemes.read(localId)
    return { type: theme.type, colors: theme.colors }
  }
  const bundled = getBundledEditorTheme(id)
  if (!bundled) {
    throw new Error(`Unknown bundled app theme: ${id}`)
  }
  const module = await bundled.loadTheme()
  const registration = module.default as {
    type?: string
    colors?: Record<string, string>
    bg?: string
    fg?: string
  }
  return {
    type: registration.type === 'light' ? 'light' : 'dark',
    colors: registration.colors,
    bg: registration.bg,
    fg: registration.fg
  }
}

function publishTerminalTheme(source: AppThemeSource | null, id: string, isDark: boolean): void {
  const theme = source ? buildAppThemeTerminalTheme(source) : null
  useAppStore
    .getState()
    .setAppThemeTerminalTheme(
      theme ? { mode: isDark ? 'dark' : 'light', appThemeId: id, theme } : null
    )
}

async function applyCurrentAppTheme(): Promise<void> {
  const generation = ++applyGeneration
  const isDark = resolveIsDark(useAppStore.getState().settings?.theme ?? 'system')
  const id = selectedAppThemeId()
  if (appliedAppThemeId === id && appliedIsDark === isDark) {
    return
  }
  if (id === DEFAULT_APP_THEME) {
    clearAppliedTokens()
    publishTerminalTheme(null, id, isDark)
    appliedIsDark = isDark
    return
  }
  try {
    const source = await loadAppThemeSource(id)
    if (generation !== applyGeneration) {
      return
    }
    const overrides = buildAppThemeTokenOverrides(source)
    if (!overrides) {
      console.warn(`App theme ${id} has no usable anchor colors; keeping Orca default`)
      clearAppliedTokens()
      publishTerminalTheme(null, id, isDark)
      appliedIsDark = isDark
      return
    }
    const root = document.documentElement
    runWithThemeTransitionsDisabled(() => {
      for (const name of appliedTokenNames) {
        if (!(name in overrides)) {
          root.style.removeProperty(name)
        }
      }
      for (const [name, value] of Object.entries(overrides)) {
        root.style.setProperty(name, value)
      }
    })
    appliedTokenNames = Object.keys(overrides)
    appliedAppThemeId = id
    appliedIsDark = isDark
    publishTerminalTheme(source, id, isDark)
  } catch (error) {
    console.warn(`Failed to apply app theme ${id}; keeping Orca default`, error)
    if (generation !== applyGeneration) {
      return
    }
    clearAppliedTokens()
    publishTerminalTheme(null, id, isDark)
    appliedIsDark = isDark
  }
}

function snapshotAppThemeSettings(): {
  theme: ThemeMode
  appThemeLight?: string
  appThemeDark?: string
} {
  const settings = useAppStore.getState().settings
  return {
    theme: settings?.theme ?? 'system',
    appThemeLight: settings?.appThemeLight,
    appThemeDark: settings?.appThemeDark
  }
}

export function ensureAppThemeController(): void {
  if (controllerStarted) {
    return
  }
  controllerStarted = true

  let lastSnapshot = snapshotAppThemeSettings()
  useAppStore.subscribe(() => {
    const snapshot = snapshotAppThemeSettings()
    if (
      snapshot.theme === lastSnapshot.theme &&
      snapshot.appThemeLight === lastSnapshot.appThemeLight &&
      snapshot.appThemeDark === lastSnapshot.appThemeDark
    ) {
      return
    }
    lastSnapshot = snapshot
    void applyCurrentAppTheme()
  })

  prefersDarkQuery().addEventListener('change', () => {
    if ((useAppStore.getState().settings?.theme ?? 'system') === 'system') {
      void applyCurrentAppTheme()
    }
  })

  void applyCurrentAppTheme()
}
