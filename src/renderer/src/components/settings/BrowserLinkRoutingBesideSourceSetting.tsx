import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSwitchRow } from './SettingsFormControls'
import { getLinkRoutingBesideSourceSearchEntry } from './browser-link-routing-copy'

type BrowserLinkRoutingBesideSourceSettingProps = {
  settings: Pick<GlobalSettings, 'openLinksInAppBesideSource'>
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function BrowserLinkRoutingBesideSourceSetting({
  settings,
  updateSettings
}: BrowserLinkRoutingBesideSourceSettingProps): React.JSX.Element {
  const entry = getLinkRoutingBesideSourceSearchEntry()

  return (
    <SearchableSetting
      title={entry.title}
      description={entry.description}
      keywords={entry.keywords}
    >
      <div className="ml-4 border-l border-border pl-4">
        <SettingsSwitchRow
          label={entry.title}
          description={entry.description}
          checked={settings.openLinksInAppBesideSource === true}
          onChange={() =>
            updateSettings({
              openLinksInAppBesideSource: settings.openLinksInAppBesideSource !== true
            })
          }
        />
      </div>
    </SearchableSetting>
  )
}
