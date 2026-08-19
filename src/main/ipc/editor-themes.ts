import { ipcMain } from 'electron'
import type { LocalEditorThemeReadRequest } from '../../shared/editor-theme-types'
import { scanLocalEditorThemes } from '../editor-themes/local-editor-theme-scan'
import { readLocalEditorTheme } from '../editor-themes/local-editor-theme-read'

export function registerEditorThemeHandlers(): void {
  ipcMain.handle('editorThemes:list', () => scanLocalEditorThemes())

  ipcMain.handle('editorThemes:read', (_event, request: LocalEditorThemeReadRequest) =>
    readLocalEditorTheme(request)
  )
}
