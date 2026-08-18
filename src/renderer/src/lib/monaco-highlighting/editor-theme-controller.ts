import { useAppStore } from '@/store'
import {
  DEFAULT_EDITOR_THEME_DARK,
  DEFAULT_EDITOR_THEME_LIGHT,
  decodeLocalEditorThemeId,
  getBundledEditorTheme,
  isLocalEditorThemeId,
  monacoThemeNameForEditorTheme
} from './editor-theme-catalog'
import { getShikiHighlighter } from './shiki-highlighter'
import { applyShikiMonacoTheme } from './monaco-shiki-theme'
import { installShikiTokenization } from './register-shiki-languages'

type EditorThemeControllerState = {
  monacoThemeName: string
  appliedEditorThemeId: string | undefined
}

const listeners = new Set<() => void>()
let controllerStarted = false
let applyGeneration = 0
const state: EditorThemeControllerState = {
  monacoThemeName: '',
  appliedEditorThemeId: undefined
}

function prefersDarkQuery(): MediaQueryList {
  return window.matchMedia('(prefers-color-scheme: dark)')
}

type AppTheme = 'system' | 'dark' | 'light'

function currentAppTheme(): AppTheme {
  return useAppStore.getState().settings?.theme ?? 'system'
}

function resolveIsDark(theme: AppTheme): boolean {
  return theme === 'dark' || (theme === 'system' && prefersDarkQuery().matches)
}

// Pre-apply (and load-failure) fallback: the stock Monaco themes match the
// pre-upgrade look, so first paint is never unstyled.
function fallbackMonacoThemeName(): string {
  return resolveIsDark(currentAppTheme()) ? 'vs-dark' : 'vs'
}

export function getMonacoThemeName(): string {
  return state.monacoThemeName || fallbackMonacoThemeName()
}

export function subscribeMonacoThemeName(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notifyListeners(): void {
  for (const listener of listeners) {
    listener()
  }
}

function selectedEditorThemeId(): { id: string; isDark: boolean } {
  const settings = useAppStore.getState().settings
  const isDark = resolveIsDark(settings?.theme ?? 'system')
  const id = isDark
    ? settings?.editorThemeDark || DEFAULT_EDITOR_THEME_DARK
    : settings?.editorThemeLight || DEFAULT_EDITOR_THEME_LIGHT
  return { id, isDark }
}

async function loadEditorThemeIntoHighlighter(id: string): Promise<string> {
  const highlighter = await getShikiHighlighter()
  if (isLocalEditorThemeId(id)) {
    const localId = decodeLocalEditorThemeId(id)
    if (!localId) {
      throw new Error(`Malformed local editor theme id: ${id}`)
    }
    const shikiThemeName = monacoThemeNameForEditorTheme(id)
    if (!highlighter.getLoadedThemes().includes(shikiThemeName)) {
      const theme = await window.api.editorThemes.read(localId)
      highlighter.loadThemeSync({
        ...theme,
        // Why: entries without settings are legal in theme JSON but violate
        // shiki's normalized shape.
        tokenColors: (theme.tokenColors ?? []).filter((entry) => entry.settings),
        name: shikiThemeName
      } as Parameters<typeof highlighter.loadThemeSync>[0])
    }
    return shikiThemeName
  }
  const bundled = getBundledEditorTheme(id)
  if (!bundled) {
    throw new Error(`Unknown bundled editor theme: ${id}`)
  }
  if (!highlighter.getLoadedThemes().includes(id)) {
    const themeModule = await bundled.loadTheme()
    highlighter.loadThemeSync(themeModule.default)
  }
  return id
}

function syncEditorSurfaceColor(background: string | undefined): void {
  const root = document.documentElement
  if (background) {
    root.style.setProperty('--editor-surface', background)
  } else {
    root.style.removeProperty('--editor-surface')
  }
}

async function applyCurrentEditorTheme(): Promise<void> {
  const generation = ++applyGeneration
  const { id, isDark } = selectedEditorThemeId()
  if (state.appliedEditorThemeId === id && state.monacoThemeName) {
    return
  }
  try {
    const shikiThemeName = await loadEditorThemeIntoHighlighter(id)
    const { monaco } = await import('@/lib/monaco-setup')
    if (generation !== applyGeneration) {
      return
    }
    const applied = await applyShikiMonacoTheme(
      monaco,
      shikiThemeName,
      monacoThemeNameForEditorTheme(id)
    )
    if (generation !== applyGeneration) {
      return
    }
    syncEditorSurfaceColor(applied.themeData.colors['editor.background'])
    installShikiTokenization(monaco)
    state.monacoThemeName = applied.monacoThemeName
    state.appliedEditorThemeId = id
    notifyListeners()
  } catch (error) {
    console.warn(`Failed to apply editor theme ${id}; falling back to stock`, error)
    if (generation !== applyGeneration) {
      return
    }
    const fallbackId = isDark ? DEFAULT_EDITOR_THEME_DARK : DEFAULT_EDITOR_THEME_LIGHT
    if (id !== fallbackId) {
      // Why: retry with the bundled default rather than leaving a broken
      // local-theme selection stuck; the stored setting is left untouched.
      state.appliedEditorThemeId = undefined
      state.monacoThemeName = ''
      syncEditorSurfaceColor(undefined)
      notifyListeners()
      await retryWithBundledDefault(fallbackId, isDark)
      return
    }
    state.monacoThemeName = ''
    state.appliedEditorThemeId = undefined
    syncEditorSurfaceColor(undefined)
    notifyListeners()
  }
}

async function retryWithBundledDefault(fallbackId: string, isDark: boolean): Promise<void> {
  const generation = ++applyGeneration
  try {
    const shikiThemeName = await loadEditorThemeIntoHighlighter(fallbackId)
    const { monaco } = await import('@/lib/monaco-setup')
    if (generation !== applyGeneration) {
      return
    }
    const applied = await applyShikiMonacoTheme(monaco, shikiThemeName, fallbackId)
    syncEditorSurfaceColor(applied.themeData.colors['editor.background'])
    installShikiTokenization(monaco)
    state.monacoThemeName = applied.monacoThemeName
    state.appliedEditorThemeId = fallbackId
    notifyListeners()
  } catch (error) {
    console.warn(`Failed to apply fallback editor theme (${isDark ? 'dark' : 'light'})`, error)
  }
}

export function ensureEditorThemeController(): void {
  if (controllerStarted) {
    return
  }
  controllerStarted = true

  let lastSnapshot = snapshotThemeSettings()
  useAppStore.subscribe(() => {
    const snapshot = snapshotThemeSettings()
    if (
      snapshot.theme === lastSnapshot.theme &&
      snapshot.editorThemeLight === lastSnapshot.editorThemeLight &&
      snapshot.editorThemeDark === lastSnapshot.editorThemeDark
    ) {
      return
    }
    lastSnapshot = snapshot
    void applyCurrentEditorTheme()
  })

  // Why: `system` theme had no listener before — the editor stayed on the
  // wrong palette until an unrelated settings change forced a re-render.
  prefersDarkQuery().addEventListener('change', () => {
    if (currentAppTheme() === 'system') {
      void applyCurrentEditorTheme()
    }
  })

  void applyCurrentEditorTheme()
}

function snapshotThemeSettings(): {
  theme: AppTheme
  editorThemeLight?: string
  editorThemeDark?: string
} {
  const settings = useAppStore.getState().settings
  return {
    theme: settings?.theme ?? 'system',
    editorThemeLight: settings?.editorThemeLight,
    editorThemeDark: settings?.editorThemeDark
  }
}
