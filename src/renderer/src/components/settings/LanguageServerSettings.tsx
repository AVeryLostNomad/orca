import { useEffect, useState } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { LspServerStateSnapshot } from '../../../../shared/lsp-types'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { Switch } from '../ui/switch'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSwitchRow } from './SettingsFormControls'

type LanguageServerSettingsProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

function installStateLabel(server: LspServerStateSnapshot): string {
  const install = server.install
  switch (install.phase) {
    case 'not-installed':
      return translate(
        'auto.components.settings.LanguageServerSettings.onDemand',
        'Downloads on first use'
      )
    case 'installing':
      return translate(
        'auto.components.settings.LanguageServerSettings.installing',
        'Installing… {{value0}}%',
        { value0: Math.round(install.progress * 100) }
      )
    case 'installed':
      return server.activeSessions > 0
        ? translate(
            'auto.components.settings.LanguageServerSettings.running',
            'Running · v{{value0}}',
            {
              value0: install.version
            }
          )
        : translate(
            'auto.components.settings.LanguageServerSettings.installed',
            'Installed · v{{value0}}',
            {
              value0: install.version
            }
          )
    case 'toolchain-missing':
      return translate(
        'auto.components.settings.LanguageServerSettings.toolchainMissing',
        'Requires {{value0}} on PATH',
        { value0: install.toolchain === 'go' ? 'Go' : install.toolchain }
      )
    case 'error':
      return install.message
  }
}

export function LanguageServerSettings({
  settings,
  updateSettings
}: LanguageServerSettingsProps): React.JSX.Element {
  const [servers, setServers] = useState<LspServerStateSnapshot[]>([])
  const lspEnabled = settings.lspEnabled === true
  const disabledServers = settings.lspDisabledServers ?? []

  useEffect(() => {
    if (!lspEnabled) {
      return
    }
    let cancelled = false
    void window.api?.lsp
      ?.getServerStates()
      .then((states) => {
        if (!cancelled && Array.isArray(states)) {
          setServers(states)
        }
      })
      .catch(() => {})
    const unsubscribe = window.api?.lsp?.onServerStateChanged?.(({ serverId, state }) => {
      setServers((current) =>
        current.map((server) =>
          server.serverId === serverId ? { ...server, install: state } : server
        )
      )
    })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [lspEnabled])

  const toggleServer = (serverId: string, enabled: boolean): void => {
    const next = enabled
      ? disabledServers.filter((id) => id !== serverId)
      : [...disabledServers.filter((id) => id !== serverId), serverId]
    updateSettings({ lspDisabledServers: next })
  }

  const title = translate(
    'auto.components.settings.LanguageServerSettings.title',
    'Code Intelligence (Language Servers)'
  )
  const description = translate(
    'auto.components.settings.LanguageServerSettings.description',
    'Rich intellisense in the file editor: completions, diagnostics, go-to-definition and more. Servers download automatically the first time a matching file opens.'
  )
  return (
    <SearchableSetting
      title={title}
      description={description}
      keywords={['lsp', 'language server', 'intellisense', 'completions', 'diagnostics', 'editor']}
    >
      <SettingsSwitchRow
        label={title}
        description={description}
        checked={lspEnabled}
        onChange={() => updateSettings({ lspEnabled: !lspEnabled })}
      />
      {lspEnabled && servers.length > 0 ? (
        <div className="mt-2 space-y-1 rounded-md border border-border p-2">
          {servers.map((server) => {
            const enabled = !disabledServers.includes(server.serverId)
            return (
              <div
                key={server.serverId}
                className="flex items-center justify-between gap-3 px-1 py-1"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium">{server.displayName}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {server.languageIds.join(', ')} · {installStateLabel(server)}
                  </div>
                </div>
                {server.install.phase === 'error' ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => {
                      void window.api?.lsp
                        ?.retryServer({ serverId: server.serverId })
                        .then(setServers)
                    }}
                  >
                    {translate('auto.components.settings.LanguageServerSettings.retry', 'Retry')}
                  </Button>
                ) : null}
                <Switch
                  checked={enabled}
                  onCheckedChange={(next) => toggleServer(server.serverId, next === true)}
                  aria-label={server.displayName}
                />
              </div>
            )
          })}
        </div>
      ) : null}
    </SearchableSetting>
  )
}
