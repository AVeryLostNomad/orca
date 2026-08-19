import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { translate } from '@/i18n/i18n'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSwitchRow } from './SettingsFormControls'

type NewTabMenuTabTypeSettingsProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

// Opt-outs for the non-terminal tab types in the new-tab menu, mirroring how
// individual agent types can be disabled to keep the menu focused.
export function NewTabMenuTabTypeSettings({
  settings,
  updateSettings
}: NewTabMenuTabTypeSettingsProps): React.JSX.Element {
  const vscodeEnabled = settings.newTabVSCodeEnabled !== false
  const dataStudioEnabled = settings.newTabDataStudioEnabled !== false
  const vscodeTitle = translate(
    'auto.components.settings.NewTabMenuTabTypeSettings.vscodeTitle',
    'VS Code Tab'
  )
  const vscodeDescription = translate(
    'auto.components.settings.NewTabMenuTabTypeSettings.vscodeDescription',
    'Offer "New VS Code Tab" in the new tab menu.'
  )
  const dataStudioTitle = translate(
    'auto.components.settings.NewTabMenuTabTypeSettings.dataStudioTitle',
    'Data Studio Tab'
  )
  const dataStudioDescription = translate(
    'auto.components.settings.NewTabMenuTabTypeSettings.dataStudioDescription',
    'Offer "New Data Studio Tab" in the new tab menu.'
  )
  return (
    <>
      <SearchableSetting
        title={vscodeTitle}
        description={vscodeDescription}
        keywords={['vscode', 'vs code', 'code server', 'new tab', 'menu', 'editor']}
      >
        <SettingsSwitchRow
          label={vscodeTitle}
          description={vscodeDescription}
          checked={vscodeEnabled}
          onChange={() => updateSettings({ newTabVSCodeEnabled: !vscodeEnabled })}
        />
      </SearchableSetting>
      <SearchableSetting
        title={dataStudioTitle}
        description={dataStudioDescription}
        keywords={['data studio', 'database', 'sql', 'new tab', 'menu']}
      >
        <SettingsSwitchRow
          label={dataStudioTitle}
          description={dataStudioDescription}
          checked={dataStudioEnabled}
          onChange={() => updateSettings({ newTabDataStudioEnabled: !dataStudioEnabled })}
        />
      </SearchableSetting>
    </>
  )
}
