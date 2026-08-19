import type React from 'react'
import { useState } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  DEFAULT_EDITOR_AUTO_SAVE_DELAY_MS,
  MAX_EDITOR_AUTO_SAVE_DELAY_MS,
  MIN_EDITOR_AUTO_SAVE_DELAY_MS
} from '../../../../shared/constants'
import { clampNumber } from '@/lib/terminal-theme'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSubsectionHeader, SettingsSwitchRow } from './SettingsFormControls'
import { translate } from '@/i18n/i18n'
import { EditorWordWrapSetting } from './EditorWordWrapSetting'
import { EditorFontFamilySetting } from './EditorFontFamilySetting'
import { EditorFontSizeSetting } from './EditorFontSizeSetting'
import { EditorColorThemeSetting } from './EditorColorThemeSetting'
import { LanguageServerSettings } from './LanguageServerSettings'
import {
  createAutoSaveDelayDraftState,
  resolveAutoSaveDelayDraftState,
  updateAutoSaveDelayDraftState
} from './auto-save-delay-draft'

type EditorCoreSettingsSectionProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
  fontSuggestions: string[]
  onRequestFontSuggestions?: () => void
}

export function EditorCoreSettingsSection({
  settings,
  updateSettings,
  fontSuggestions,
  onRequestFontSuggestions
}: EditorCoreSettingsSectionProps): React.JSX.Element {
  const [autoSaveDelayDraftState, setAutoSaveDelayDraftState] = useState(() =>
    createAutoSaveDelayDraftState(settings.editorAutoSaveDelayMs)
  )

  const resolvedAutoSaveDelayDraftState = resolveAutoSaveDelayDraftState(
    autoSaveDelayDraftState,
    settings.editorAutoSaveDelayMs
  )
  if (resolvedAutoSaveDelayDraftState !== autoSaveDelayDraftState) {
    // Why: Settings can be updated outside this pane; reconcile drafts before
    // paint so the visible input never lags behind the persisted value.
    setAutoSaveDelayDraftState(resolvedAutoSaveDelayDraftState)
  }
  const autoSaveDelayDraft = resolvedAutoSaveDelayDraftState.draft

  const updateAutoSaveDelayDraft = (draft: string): void => {
    setAutoSaveDelayDraftState((current) =>
      updateAutoSaveDelayDraftState(current, settings.editorAutoSaveDelayMs, draft)
    )
  }

  const commitAutoSaveDelay = (): void => {
    const trimmed = autoSaveDelayDraft.trim()
    if (trimmed === '') {
      setAutoSaveDelayDraftState(createAutoSaveDelayDraftState(settings.editorAutoSaveDelayMs))
      return
    }

    const value = Number(trimmed)
    if (!Number.isFinite(value)) {
      setAutoSaveDelayDraftState(createAutoSaveDelayDraftState(settings.editorAutoSaveDelayMs))
      return
    }

    const next = clampNumber(
      Math.round(value),
      MIN_EDITOR_AUTO_SAVE_DELAY_MS,
      MAX_EDITOR_AUTO_SAVE_DELAY_MS
    )
    updateSettings({ editorAutoSaveDelayMs: next })
    setAutoSaveDelayDraftState((current) =>
      updateAutoSaveDelayDraftState(current, settings.editorAutoSaveDelayMs, String(next))
    )
  }

  return (
    <section key="editor-core" className="space-y-4">
      <SettingsSubsectionHeader
        title={translate('auto.components.settings.EditorCoreSettingsSection.title', 'Editing')}
        description={translate(
          'auto.components.settings.GeneralEditorSettingsSection.d21136d9ef',
          'Configure how Orca persists file edits.'
        )}
      />

      <EditorColorThemeSetting settings={settings} updateSettings={updateSettings} />

      <EditorFontFamilySetting
        settings={settings}
        updateSettings={updateSettings}
        fontSuggestions={fontSuggestions}
        onRequestFontSuggestions={onRequestFontSuggestions}
      />

      <EditorFontSizeSetting settings={settings} updateSettings={updateSettings} />

      <EditorWordWrapSetting settings={settings} updateSettings={updateSettings} />

      <SearchableSetting
        title={translate(
          'auto.components.settings.GeneralEditorSettingsSection.6690b1ffb9',
          'Minimap'
        )}
        description={translate(
          'auto.components.settings.GeneralEditorSettingsSection.51161d1647',
          'Show the minimap overview when editing a file.'
        )}
        keywords={['minimap', 'overview', 'code', 'scroll']}
      >
        <SettingsSwitchRow
          label={translate(
            'auto.components.settings.GeneralEditorSettingsSection.6690b1ffb9',
            'Minimap'
          )}
          description={translate(
            'auto.components.settings.GeneralEditorSettingsSection.51161d1647',
            'Show the minimap overview when editing a file.'
          )}
          checked={settings.editorMinimapEnabled}
          onChange={() => updateSettings({ editorMinimapEnabled: !settings.editorMinimapEnabled })}
        />
      </SearchableSetting>

      <SearchableSetting
        title={translate(
          'auto.components.settings.GeneralEditorSettingsSection.0df2e4fd12',
          'Auto Save Files'
        )}
        description={translate(
          'auto.components.settings.GeneralEditorSettingsSection.70bb30feb1',
          'Save editor and editable diff changes automatically after a short pause.'
        )}
        keywords={['autosave', 'save']}
      >
        <SettingsSwitchRow
          label={translate(
            'auto.components.settings.GeneralEditorSettingsSection.0df2e4fd12',
            'Auto Save Files'
          )}
          description={translate(
            'auto.components.settings.GeneralEditorSettingsSection.70bb30feb1',
            'Save editor and editable diff changes automatically after a short pause.'
          )}
          checked={settings.editorAutoSave}
          onChange={() => updateSettings({ editorAutoSave: !settings.editorAutoSave })}
        />
      </SearchableSetting>

      <SearchableSetting
        title={translate(
          'auto.components.settings.GeneralEditorSettingsSection.d6cf227ca0',
          'Auto Save Delay'
        )}
        description={translate(
          'auto.components.settings.GeneralEditorSettingsSection.1bec6d8318',
          'How long Orca waits after your last edit before saving automatically.'
        )}
        keywords={['autosave', 'delay', 'milliseconds']}
        className="flex items-center justify-between gap-4 py-2"
      >
        <div className="min-w-0 flex-1 space-y-0.5">
          <Label>
            {translate(
              'auto.components.settings.GeneralEditorSettingsSection.d6cf227ca0',
              'Auto Save Delay'
            )}
          </Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.GeneralEditorSettingsSection.8112cd6dcf',
              'How long Orca waits after your last edit before saving automatically. First launch defaults to'
            )}{' '}
            {DEFAULT_EDITOR_AUTO_SAVE_DELAY_MS}{' '}
            {translate('auto.components.settings.GeneralEditorSettingsSection.fc5c5306ff', 'ms.')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Input
            type="number"
            min={MIN_EDITOR_AUTO_SAVE_DELAY_MS}
            max={MAX_EDITOR_AUTO_SAVE_DELAY_MS}
            step={250}
            value={autoSaveDelayDraft}
            onChange={(e) => updateAutoSaveDelayDraft(e.target.value)}
            onBlur={commitAutoSaveDelay}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commitAutoSaveDelay()
              }
            }}
            className="number-input-clean w-28 text-right tabular-nums"
          />
          <span className="text-xs text-muted-foreground">
            {translate('auto.components.settings.GeneralEditorSettingsSection.a5db1d3975', 'ms')}
          </span>
        </div>
      </SearchableSetting>

      <LanguageServerSettings settings={settings} updateSettings={updateSettings} />
    </section>
  )
}
