import { useEffect, useSyncExternalStore } from 'react'
import {
  ensureEditorThemeController,
  getMonacoThemeName,
  subscribeMonacoThemeName
} from './editor-theme-controller'

// Single source of truth for every Monaco surface's `theme` value. Returns the
// stock `vs`/`vs-dark` name until the controller applies the configured theme.
export function useMonacoThemeName(): string {
  useEffect(() => {
    ensureEditorThemeController()
  }, [])
  return useSyncExternalStore(subscribeMonacoThemeName, getMonacoThemeName)
}
