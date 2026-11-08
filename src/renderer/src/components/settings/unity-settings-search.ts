import { translate } from '@/i18n/i18n'
import type { SettingsSearchEntry } from './settings-search'
import { translateSearchKeyword } from './settings-search-keywords'

/** Unity section rows for the Editor pane's settings search. */
export function getUnitySettingsSearchEntries(): SettingsSearchEntry[] {
  return [
    {
      title: translate(
        'auto.components.settings.general.search.unityIntegration',
        'Unity Integration'
      ),
      description: translate(
        'auto.components.settings.general.search.unityIntegrationDesc',
        'Editor controls, console, tests and meta-file handling for workspaces that contain a Unity project.'
      ),
      keywords: [
        ...translateSearchKeyword('auto.components.settings.general.search.unityKw', 'unity'),
        ...translateSearchKeyword(
          'auto.components.settings.general.search.playModeKw',
          'play mode'
        ),
        ...translateSearchKeyword('auto.components.settings.general.search.pipelineKw', 'pipeline')
      ]
    },
    {
      title: translate('auto.components.settings.general.search.unityHideMeta', 'Hide .meta Files'),
      description: translate(
        'auto.components.settings.general.search.unityHideMetaDesc',
        'Hide Unity .meta files in the file explorer and quick open.'
      ),
      keywords: [
        ...translateSearchKeyword('auto.components.settings.general.search.unityKw', 'unity'),
        ...translateSearchKeyword('auto.components.settings.general.search.metaKw', 'meta')
      ]
    },
    {
      title: translate(
        'auto.components.settings.general.search.unityAutoRefresh',
        'Refresh Assets on Save'
      ),
      description: translate(
        'auto.components.settings.general.search.unityAutoRefreshDesc',
        'Ask the connected Unity editor to refresh its asset database after saving files under Assets or Packages.'
      ),
      keywords: [
        ...translateSearchKeyword('auto.components.settings.general.search.unityKw', 'unity'),
        ...translateSearchKeyword('auto.components.settings.general.search.refreshKw', 'refresh')
      ]
    },
    {
      title: translate(
        'auto.components.settings.general.search.unityEditorPackage',
        'Use Orca as the Script Editor'
      ),
      description: translate(
        'auto.components.settings.general.search.unityEditorPackageDesc',
        "Install Orca's editor package into opened Unity projects so Unity opens scripts in Orca."
      ),
      keywords: [
        ...translateSearchKeyword('auto.components.settings.general.search.unityKw', 'unity'),
        ...translateSearchKeyword(
          'auto.components.settings.general.search.externalScriptEditorKw',
          'external script editor'
        )
      ]
    },
    {
      title: translate(
        'auto.components.settings.general.search.unityExplorerScope',
        'Default Explorer Scope'
      ),
      description: translate(
        'auto.components.settings.general.search.unityExplorerScopeDesc',
        'What the file explorer shows for a Unity project until you pick a scope in its header.'
      ),
      keywords: [
        ...translateSearchKeyword('auto.components.settings.general.search.unityKw', 'unity'),
        ...translateSearchKeyword('auto.components.settings.general.search.assetsKw', 'assets'),
        ...translateSearchKeyword('auto.components.settings.general.search.scopeKw', 'scope')
      ]
    }
  ]
}
