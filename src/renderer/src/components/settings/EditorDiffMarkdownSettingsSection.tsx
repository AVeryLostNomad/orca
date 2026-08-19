import type React from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { Label } from '../ui/label'
import { SearchableSetting } from './SearchableSetting'
import {
  SettingsSegmentedControl,
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from './SettingsFormControls'
import { translate } from '@/i18n/i18n'
import { RichMarkdownSpellcheckSetting } from './RichMarkdownSpellcheckSetting'

type EditorDiffMarkdownSettingsSectionProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function EditorDiffMarkdownSettingsSection({
  settings,
  updateSettings
}: EditorDiffMarkdownSettingsSectionProps): React.JSX.Element {
  return (
    <section key="editor-diff-markdown" className="space-y-4">
      <SettingsSubsectionHeader
        title={translate(
          'auto.components.settings.EditorDiffMarkdownSettingsSection.title',
          'Diffs & Markdown'
        )}
      />

      <SearchableSetting
        title={translate(
          'auto.components.settings.GeneralEditorSettingsSection.7311f67ee7',
          'Default Diff View'
        )}
        description={translate(
          'auto.components.settings.GeneralEditorSettingsSection.b492397d34',
          'Preferred presentation format for showing git diffs by default.'
        )}
        keywords={['diff', 'view', 'inline', 'side-by-side', 'split']}
        className="flex items-center justify-between gap-4 py-2"
      >
        <div className="min-w-0 flex-1 space-y-0.5">
          <Label>
            {translate(
              'auto.components.settings.GeneralEditorSettingsSection.7311f67ee7',
              'Default Diff View'
            )}
          </Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.GeneralEditorSettingsSection.b492397d34',
              'Preferred presentation format for showing git diffs by default.'
            )}
          </p>
        </div>
        <SettingsSegmentedControl
          ariaLabel={translate(
            'auto.components.settings.GeneralEditorSettingsSection.7311f67ee7',
            'Default Diff View'
          )}
          value={settings.diffDefaultView}
          onChange={(option) => updateSettings({ diffDefaultView: option })}
          options={[
            {
              value: 'inline',
              label: translate(
                'auto.components.settings.GeneralEditorSettingsSection.05b6df93b3',
                'Inline'
              )
            },
            {
              value: 'side-by-side',
              label: translate(
                'auto.components.settings.GeneralEditorSettingsSection.12cbc0d0d6',
                'Side-by-side'
              )
            }
          ]}
        />
      </SearchableSetting>

      <SearchableSetting
        title={translate(
          'auto.components.settings.GeneralEditorSettingsSection.8f1afdfbd8',
          'Diff Word Wrap'
        )}
        description={translate(
          'auto.components.settings.GeneralEditorSettingsSection.4aa4d9fb73',
          'Wrap long lines in diff editors instead of requiring horizontal scrolling.'
        )}
        keywords={['diff', 'word wrap', 'wrap', 'markdown', 'long lines']}
        className="flex items-center justify-between gap-4 py-2"
      >
        <div className="min-w-0 flex-1 space-y-0.5">
          <Label>
            {translate(
              'auto.components.settings.GeneralEditorSettingsSection.8f1afdfbd8',
              'Diff Word Wrap'
            )}
          </Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.GeneralEditorSettingsSection.4aa4d9fb73',
              'Wrap long lines in diff editors instead of requiring horizontal scrolling.'
            )}
          </p>
        </div>
        <SettingsSegmentedControl
          ariaLabel={translate(
            'auto.components.settings.GeneralEditorSettingsSection.8f1afdfbd8',
            'Diff Word Wrap'
          )}
          value={settings.diffWordWrap ? 'on' : 'off'}
          onChange={(option) => updateSettings({ diffWordWrap: option === 'on' })}
          options={[
            {
              value: 'off',
              label: translate(
                'auto.components.settings.GeneralEditorSettingsSection.bf16ef0af2',
                'Off'
              )
            },
            {
              value: 'on',
              label: translate(
                'auto.components.settings.GeneralEditorSettingsSection.3f6892f307',
                'On'
              )
            }
          ]}
        />
      </SearchableSetting>

      <SearchableSetting
        title={translate(
          'auto.components.settings.GeneralEditorSettingsSection.1de48ad940',
          'Default Diff File Tree'
        )}
        description={translate(
          'auto.components.settings.GeneralEditorSettingsSection.1b87897af9',
          'Show or hide the file tree when opening combined diff views.'
        )}
        keywords={['diff', 'tree', 'file tree', 'combined diff', 'sidebar']}
        className="flex items-center justify-between gap-4 py-2"
      >
        <div className="min-w-0 flex-1 space-y-0.5">
          <Label>
            {translate(
              'auto.components.settings.GeneralEditorSettingsSection.1de48ad940',
              'Default Diff File Tree'
            )}
          </Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.GeneralEditorSettingsSection.1b87897af9',
              'Show or hide the file tree when opening combined diff views.'
            )}
          </p>
        </div>
        <SettingsSegmentedControl
          ariaLabel={translate(
            'auto.components.settings.GeneralEditorSettingsSection.1de48ad940',
            'Default Diff File Tree'
          )}
          value={settings.combinedDiffFileTreeVisibleByDefault ? 'shown' : 'hidden'}
          onChange={(option) =>
            updateSettings({ combinedDiffFileTreeVisibleByDefault: option === 'shown' })
          }
          options={[
            {
              value: 'shown',
              label: translate(
                'auto.components.settings.GeneralEditorSettingsSection.73a09aad63',
                'Shown'
              )
            },
            {
              value: 'hidden',
              label: translate(
                'auto.components.settings.GeneralEditorSettingsSection.5a1ea6eaa2',
                'Hidden'
              )
            }
          ]}
        />
      </SearchableSetting>

      <RichMarkdownSpellcheckSetting settings={settings} updateSettings={updateSettings} />

      <SearchableSetting
        title={translate(
          'auto.components.settings.GeneralEditorSettingsSection.4edc104f0f',
          'Markdown Review Notes'
        )}
        description={translate(
          'auto.components.settings.GeneralEditorSettingsSection.5f02e6fb21',
          'Show local markdown review note controls in rich editor mode.'
        )}
        keywords={['markdown', 'review', 'notes', 'annotations', 'agents']}
      >
        <SettingsSwitchRow
          label={translate(
            'auto.components.settings.GeneralEditorSettingsSection.4edc104f0f',
            'Markdown Review Notes'
          )}
          description={translate(
            'auto.components.settings.GeneralEditorSettingsSection.f80603d293',
            'Show local markdown note controls in rich editor mode and agent handoff actions.'
          )}
          checked={settings.markdownReviewToolsEnabled}
          onChange={() =>
            updateSettings({ markdownReviewToolsEnabled: !settings.markdownReviewToolsEnabled })
          }
        />
      </SearchableSetting>
    </section>
  )
}
