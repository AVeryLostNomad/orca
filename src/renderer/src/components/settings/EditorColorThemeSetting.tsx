import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  BUNDLED_EDITOR_THEMES,
  DEFAULT_EDITOR_THEME_DARK,
  DEFAULT_EDITOR_THEME_LIGHT
} from '@/lib/monaco-highlighting/editor-theme-catalog'
import { translate } from '@/i18n/i18n'
import { Label } from '../ui/label'
import { SearchableSetting } from './SearchableSetting'
import {
  localThemeOptions,
  ThemeSlotSelect,
  useLocalEditorThemes,
  type ThemeOption
} from './theme-slot-select'

type EditorColorThemeSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function EditorColorThemeSetting({
  settings,
  updateSettings
}: EditorColorThemeSettingProps): React.JSX.Element {
  const localThemes = useLocalEditorThemes()

  const bundledLight: ThemeOption[] = BUNDLED_EDITOR_THEMES.filter((t) => t.kind === 'light').map(
    (t) => ({ value: t.id, label: t.label })
  )
  const bundledDark: ThemeOption[] = BUNDLED_EDITOR_THEMES.filter((t) => t.kind === 'dark').map(
    (t) => ({ value: t.id, label: t.label })
  )

  const title = translate(
    'auto.components.settings.EditorColorThemeSetting.title',
    'Editor Color Theme'
  )
  const description = translate(
    'auto.components.settings.EditorColorThemeSetting.description',
    'Syntax and editor colors for code files — bundled themes plus color themes installed in VS Code, Cursor, or VSCodium.'
  )
  return (
    <SearchableSetting
      title={title}
      description={description}
      keywords={['editor', 'theme', 'color', 'syntax', 'highlighting', 'vs code', 'dark', 'light']}
    >
      <div className="space-y-0.5">
        <Label>{title}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <ThemeSlotSelect
        label={translate(
          'auto.components.settings.EditorColorThemeSetting.lightTheme',
          'Light Theme'
        )}
        value={settings.editorThemeLight || DEFAULT_EDITOR_THEME_LIGHT}
        bundled={bundledLight}
        local={localThemeOptions(localThemes, 'light')}
        onChange={(value) => updateSettings({ editorThemeLight: value })}
      />
      <ThemeSlotSelect
        label={translate(
          'auto.components.settings.EditorColorThemeSetting.darkTheme',
          'Dark Theme'
        )}
        value={settings.editorThemeDark || DEFAULT_EDITOR_THEME_DARK}
        bundled={bundledDark}
        local={localThemeOptions(localThemes, 'dark')}
        onChange={(value) => updateSettings({ editorThemeDark: value })}
      />
    </SearchableSetting>
  )
}
