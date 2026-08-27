import { translate } from '@/i18n/i18n'
import { Switch } from '@/components/ui/switch'

type TerminalQuickCommandModalModeSwitchProps = {
  modalMode: boolean
  onToggle: () => void
  disabled?: boolean
}

export function TerminalQuickCommandModalModeSwitch({
  modalMode,
  onToggle,
  disabled = false
}: TerminalQuickCommandModalModeSwitchProps): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-0.5">
        <div className="text-sm font-medium">
          {translate(
            'auto.components.terminal.quick.commands.TerminalQuickCommandModalModeSwitch.675e119ac6',
            'Run in Popup'
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {translate(
            'auto.components.terminal.quick.commands.TerminalQuickCommandModalModeSwitch.b4d749f4cc',
            'Run in a temporary window that closes when the command exits, instead of a new tab.'
          )}
        </div>
      </div>
      <Switch
        checked={modalMode}
        disabled={disabled}
        aria-label={translate(
          'auto.components.terminal.quick.commands.TerminalQuickCommandModalModeSwitch.c6381a6cbc',
          'Toggle run in popup'
        )}
        onCheckedChange={onToggle}
      />
    </div>
  )
}
