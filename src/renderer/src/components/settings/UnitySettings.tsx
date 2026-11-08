import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { SearchableSetting } from './SearchableSetting'
import {
  SettingsSegmentedControl,
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from './SettingsFormControls'

type UnitySettingsProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function UnitySettings({ settings, updateSettings }: UnitySettingsProps): React.JSX.Element {
  const integrationEnabled = settings.unityIntegrationEnabled !== false
  const hideMetaFiles = settings.unityHideMetaFiles !== false
  const autoRefreshOnSave = settings.unityAutoRefreshOnSave !== false
  const autoInstallEditorPackage = settings.unityAutoInstallEditorPackage !== false
  const dismissedPromptCount = settings.unityPipelinePromptDismissed?.length ?? 0

  const integrationTitle = translate(
    'auto.components.settings.UnitySettings.integrationTitle',
    'Unity Integration'
  )
  const integrationDescription = translate(
    'auto.components.settings.UnitySettings.integrationDescription',
    'Editor controls, console, tests and meta-file handling for workspaces that contain a Unity project.'
  )
  const hideMetaTitle = translate(
    'auto.components.settings.UnitySettings.hideMetaTitle',
    'Hide .meta Files'
  )
  const hideMetaDescription = translate(
    'auto.components.settings.UnitySettings.hideMetaDescription',
    'Hide Unity .meta files in the file explorer and quick open. Renames, moves and deletes still carry them along.'
  )
  const autoRefreshTitle = translate(
    'auto.components.settings.UnitySettings.autoRefreshTitle',
    'Refresh Assets on Save'
  )
  const autoRefreshDescription = translate(
    'auto.components.settings.UnitySettings.autoRefreshDescription',
    'Ask the connected Unity editor to refresh its asset database after saving files under Assets or Packages.'
  )
  const scopeTitle = translate(
    'auto.components.settings.UnitySettings.scopeTitle',
    'Default Explorer Scope'
  )
  const scopeDescription = translate(
    'auto.components.settings.UnitySettings.scopeDescription',
    'What the file explorer shows for a Unity project until you pick a scope in its header.'
  )

  const editorPackageTitle = translate(
    'auto.components.settings.UnitySettings.editorPackageTitle',
    'Use Orca as the Script Editor'
  )
  const editorPackageDescription = translate(
    'auto.components.settings.UnitySettings.editorPackageDescription',
    "Install Orca's editor package into opened Unity projects. It makes Orca Unity's External Script Editor once per project and generates the project files Orca's C# support loads."
  )

  return (
    <section key="unity" className="space-y-4">
      <SettingsSubsectionHeader
        title={translate('auto.components.settings.UnitySettings.title', 'Unity')}
        description={translate(
          'auto.components.settings.UnitySettings.description',
          'Unity project support. Editor control uses the Unity CLI and the Unity Pipeline package.'
        )}
      />
      <SearchableSetting
        title={integrationTitle}
        description={integrationDescription}
        keywords={['unity', 'game', 'editor', 'play mode', 'console', 'tests', 'pipeline']}
      >
        <SettingsSwitchRow
          label={integrationTitle}
          description={integrationDescription}
          checked={integrationEnabled}
          onChange={() => updateSettings({ unityIntegrationEnabled: !integrationEnabled })}
        />
      </SearchableSetting>
      <SearchableSetting
        title={hideMetaTitle}
        description={hideMetaDescription}
        keywords={['unity', 'meta', 'hidden', 'explorer', 'quick open']}
      >
        <SettingsSwitchRow
          label={hideMetaTitle}
          description={hideMetaDescription}
          checked={hideMetaFiles}
          disabled={!integrationEnabled}
          onChange={() => updateSettings({ unityHideMetaFiles: !hideMetaFiles })}
        />
      </SearchableSetting>
      <SearchableSetting
        title={scopeTitle}
        description={scopeDescription}
        keywords={['unity', 'explorer', 'scope', 'assets', 'packages', 'whole folder']}
        className="flex items-center justify-between gap-4 py-2"
      >
        <div className="min-w-0 flex-1 space-y-0.5">
          <Label>{scopeTitle}</Label>
          <p className="text-xs text-muted-foreground">{scopeDescription}</p>
        </div>
        <SettingsSegmentedControl
          ariaLabel={scopeTitle}
          value={settings.unityExplorerDefaultScope ?? 'assets'}
          onChange={(option) => updateSettings({ unityExplorerDefaultScope: option })}
          options={[
            {
              value: 'assets',
              label: translate('auto.components.settings.UnitySettings.scopeAssets', 'Assets'),
              disabled: !integrationEnabled
            },
            {
              value: 'whole-folder',
              label: translate(
                'auto.components.settings.UnitySettings.scopeWholeFolder',
                'Whole folder'
              ),
              disabled: !integrationEnabled
            }
          ]}
        />
      </SearchableSetting>
      <SearchableSetting
        title={autoRefreshTitle}
        description={autoRefreshDescription}
        keywords={['unity', 'refresh', 'save', 'asset database', 'recompile']}
      >
        <SettingsSwitchRow
          label={autoRefreshTitle}
          description={autoRefreshDescription}
          checked={autoRefreshOnSave}
          disabled={!integrationEnabled}
          onChange={() => updateSettings({ unityAutoRefreshOnSave: !autoRefreshOnSave })}
        />
      </SearchableSetting>
      <SearchableSetting
        title={editorPackageTitle}
        description={editorPackageDescription}
        keywords={['unity', 'external script editor', 'package', 'csproj', 'solution', 'open']}
      >
        <SettingsSwitchRow
          label={editorPackageTitle}
          description={editorPackageDescription}
          checked={autoInstallEditorPackage}
          disabled={!integrationEnabled}
          onChange={() =>
            updateSettings({ unityAutoInstallEditorPackage: !autoInstallEditorPackage })
          }
        />
      </SearchableSetting>
      {dismissedPromptCount > 0 ? (
        <div className="flex items-center justify-between gap-4 py-1">
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.UnitySettings.dismissedPrompts',
              'Projects with the Unity Pipeline install prompt hidden: {{value0}}',
              { value0: dismissedPromptCount }
            )}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => updateSettings({ unityPipelinePromptDismissed: [] })}
          >
            {translate('auto.components.settings.UnitySettings.resetPrompts', 'Show Again')}
          </Button>
        </div>
      ) : null}
    </section>
  )
}
