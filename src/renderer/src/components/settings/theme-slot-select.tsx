import { useEffect, useState } from 'react'
import type { LocalEditorThemeDescriptor } from '../../../../shared/editor-theme-types'
import { encodeLocalEditorThemeId } from '@/lib/monaco-highlighting/editor-theme-catalog'
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

export type ThemeOption = { value: string; label: string }

function isLightUiTheme(uiTheme: string): boolean {
  return uiTheme === 'vs' || uiTheme === 'hc-light'
}

export function localThemeOptions(
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

/** Themes scanned from installed VS Code / Cursor / VSCodium extensions. */
export function useLocalEditorThemes(): LocalEditorThemeDescriptor[] {
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

  return localThemes
}

const NO_LEADING_OPTIONS: ThemeOption[] = []

export function ThemeSlotSelect({
  label,
  value,
  bundled,
  local,
  leadingOptions = NO_LEADING_OPTIONS,
  onChange
}: {
  label: string
  value: string
  bundled: ThemeOption[]
  local: ThemeOption[]
  /** Entries pinned above the bundled group (e.g. "Orca Default"). */
  leadingOptions?: ThemeOption[]
  onChange: (value: string) => void
}): React.JSX.Element {
  // A stored local theme whose extension was uninstalled still needs a visible
  // entry, or the Select would render empty.
  const missingSelection =
    value &&
    !leadingOptions.some((o) => o.value === value) &&
    !bundled.some((o) => o.value === value) &&
    !local.some((o) => o.value === value)
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <Label className="min-w-0 flex-1">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {leadingOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
          {leadingOptions.length > 0 ? <SelectSeparator /> : null}
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
