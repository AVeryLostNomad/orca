import { useEffect, useState } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { LocalEditorThemeDescriptor } from '../../../../shared/editor-theme-types'
import {
  BUNDLED_EDITOR_THEMES,
  DEFAULT_EDITOR_THEME_DARK,
  DEFAULT_EDITOR_THEME_LIGHT,
  encodeLocalEditorThemeId
} from '@/lib/monaco-highlighting/editor-theme-catalog'
import { translate } from '@/i18n/i18n'
import { Label } from '../ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue
} from '../ui/select'
import { SearchableSetting } from './SearchableSetting'

type EditorColorThemeSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

type ThemeOption = { value: string; label: string }

function isLightUiTheme(uiTheme: string): boolean {
  return uiTheme === 'vs' || uiTheme === 'hc-light'
}

function localThemeOptions(
  localThemes: LocalEditorThemeDescriptor[],
  kind: 'light' | 'dark'
): ThemeOption[] {
  return localThemes
    .filter((theme) => isLightUiTheme(theme.uiTheme) === (kind === 'light'))
    .map((theme) => ({
      value: encodeLocalEditorThemeId(theme),
      label: `${theme.sourceName} · ${theme.label}`
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

function ThemeSlotSelect({
  label,
  value,
  bundled,
  local,
  onChange
}: {
  label: string
  value: string
  bundled: ThemeOption[]
  local: ThemeOption[]
  onChange: (value: string) => void
}): React.JSX.Element {
  // A stored local theme whose extension was uninstalled still needs a visible
  // entry, or the Select would render empty.
  const missingSelection =
    value && !bundled.some((o) => o.value === value) && !local.some((o) => o.value === value)
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <Label className="min-w-0 flex-1">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {bundled.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
          {local.length > 0 ? <SelectSeparator /> : null}
          {local.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
          {missingSelection ? (
            <SelectItem value={value}>
              {translate(
                'auto.components.settings.EditorColorThemeSetting.missing',
                'Missing theme'
              )}
            </SelectItem>
          ) : null}
        </SelectContent>
      </Select>
    </div>
  )
}

export function EditorColorThemeSetting({
  settings,
  updateSettings
}: EditorColorThemeSettingProps): React.JSX.Element {
  const [localThemes, setLocalThemes] = useState<LocalEditorThemeDescriptor[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const themes = await window.api?.editorThemes?.list()
        if (!cancelled && Array.isArray(themes)) {
          setLocalThemes(themes)
        }
      } catch {
        // Local editors are optional; the bundled list stands alone.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

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
