import { ipcRenderer } from 'electron'
import type {
  LocalEditorThemeDescriptor,
  LocalEditorThemeReadRequest,
  MergedVSCodeTheme
} from '../../shared/editor-theme-types'
import type { PreloadApi } from '../api-types'

export const editorThemesApi = {
  list: (): Promise<LocalEditorThemeDescriptor[]> => ipcRenderer.invoke('editorThemes:list'),
  read: (request: LocalEditorThemeReadRequest): Promise<MergedVSCodeTheme> =>
    ipcRenderer.invoke('editorThemes:read', request)
} satisfies PreloadApi['editorThemes']
