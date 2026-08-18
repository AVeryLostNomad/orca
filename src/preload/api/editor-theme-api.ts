import type {
  LocalEditorThemeDescriptor,
  LocalEditorThemeReadRequest,
  MergedVSCodeTheme
} from '../../shared/editor-theme-types'

export type EditorThemesApi = {
  list: () => Promise<LocalEditorThemeDescriptor[]>
  read: (request: LocalEditorThemeReadRequest) => Promise<MergedVSCodeTheme>
}
