import type React from 'react'
import { useState } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  EDITOR_FONT_SIZE_MAX,
  EDITOR_FONT_SIZE_MIN,
  normalizeEditorFontSize
} from '../../../../shared/editor-font-size'
import { translate } from '@/i18n/i18n'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { SearchableSetting } from './SearchableSetting'

type EditorFontSizeSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function EditorFontSizeSetting({
  settings,
  updateSettings
}: EditorFontSizeSettingProps): React.JSX.Element {
  const persisted = settings.editorFontSize
  const [draft, setDraft] = useState<string>(persisted == null ? '' : String(persisted))
  const [draftBase, setDraftBase] = useState<number | undefined>(persisted)
  if (draftBase !== persisted) {
    // Why: the setting can change outside this input (another window, reset);
    // reconcile before paint so the visible value never lags the stored one.
    setDraftBase(persisted)
    setDraft(persisted == null ? '' : String(persisted))
  }

  const commit = (): void => {
    const trimmed = draft.trim()
    if (trimmed === '') {
      updateSettings({ editorFontSize: undefined })
      setDraft('')
      return
    }
    const normalized = normalizeEditorFontSize(Number(trimmed))
    updateSettings({ editorFontSize: normalized })
    setDraft(normalized == null ? '' : String(normalized))
  }

  const title = translate(
    'auto.components.settings.EditorFontSizeSetting.title',
    'Editor Font Size'
  )
  const description = translate(
    'auto.components.settings.EditorFontSizeSetting.description',
    'Font size for file editors and diffs. Leave empty to follow the terminal font size.'
  )

  return (
    <SearchableSetting
      title={title}
      description={description}
      keywords={['editor', 'font', 'size', 'text size', 'code']}
      className="flex items-center justify-between gap-4 py-2"
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <Label>{title}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Input
        type="number"
        min={EDITOR_FONT_SIZE_MIN}
        max={EDITOR_FONT_SIZE_MAX}
        step={1}
        value={draft}
        placeholder={`${translate(
          'auto.components.settings.EditorFontSizeSetting.placeholder',
          'Same as terminal'
        )} (${settings.terminalFontSize ?? 13})`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit()
          }
        }}
        className="number-input-clean w-40 shrink-0 text-right tabular-nums"
      />
    </SearchableSetting>
  )
}
