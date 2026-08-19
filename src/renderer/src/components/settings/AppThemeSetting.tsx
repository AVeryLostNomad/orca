import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { BUNDLED_EDITOR_THEMES } from '@/lib/monaco-highlighting/editor-theme-catalog'
import { DEFAULT_APP_THEME } from '@/lib/app-theme/app-theme-controller'
import { translate } from '@/i18n/i18n'
import { Label } from '../ui/label'
import { SearchableSetting } from './SearchableSetting'
import {
  localThemeOptions,
  ThemeSlotSelect,
  useLocalEditorThemes,
  type ThemeOption
} from './theme-slot-select'

type AppThemeSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function AppThemeSetting({
  settings,
  updateSettings
}: AppThemeSettingProps): React.JSX.Element {
  const localThemes = useLocalEditorThemes()

  const orcaDefault: ThemeOption = {
    value: DEFAULT_APP_THEME,
    label: translate('auto.components.settings.AppThemeSetting.orcaDefault', 'Orca Default')
  }
  const bundledLight: ThemeOption[] = BUNDLED_EDITOR_THEMES.filter((t) => t.kind === 'light').map(
    (t) => ({ value: t.id, label: t.label })
  )
  const bundledDark: ThemeOption[] = BUNDLED_EDITOR_THEMES.filter((t) => t.kind === 'dark').map(
    (t) => ({ value: t.id, label: t.label })
  )

  const title = translate('auto.components.settings.AppThemeSetting.title', 'App Theme')
  const description = translate(
    'auto.components.settings.AppThemeSetting.description',
    'Color the Orca window chrome from an editor theme’s palette — separate from the editor theme itself.'
  )
  return (
    <SearchableSetting
      title={title}
      description={description}
      keywords={['app', 'theme', 'chrome', 'color', 'workbench', 'vs code', 'dark', 'light']}
    >
      <div className="space-y-0.5">
        <Label>{title}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <ThemeSlotSelect
        label={translate('auto.components.settings.AppThemeSetting.lightTheme', 'Light Theme')}
        value={settings.appThemeLight || DEFAULT_APP_THEME}
        bundled={bundledLight}
        local={localThemeOptions(localThemes, 'light')}
        leadingOptions={[orcaDefault]}
        onChange={(value) => updateSettings({ appThemeLight: value })}
      />
      <ThemeSlotSelect
        label={translate('auto.components.settings.AppThemeSetting.darkTheme', 'Dark Theme')}
        value={settings.appThemeDark || DEFAULT_APP_THEME}
        bundled={bundledDark}
        local={localThemeOptions(localThemes, 'dark')}
        leadingOptions={[orcaDefault]}
        onChange={(value) => updateSettings({ appThemeDark: value })}
      />
    </SearchableSetting>
  )
}
