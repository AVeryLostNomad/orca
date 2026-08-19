import type React from 'react'
import type { KeybindingActionId } from '../../../../shared/keybindings'
import { useShortcutKeyComboDetails } from '@/hooks/useShortcutLabel'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'

/** Right-aligned live chord label for a command-bar action row. */
export function PaletteActionShortcutBadge({
  actionId
}: {
  actionId: KeybindingActionId
}): React.JSX.Element | null {
  const combo = useShortcutKeyComboDetails(actionId)[0]
  if (!combo || combo.keys.length === 0) {
    return null
  }
  return (
    <ShortcutKeyCombo
      keys={combo.keys}
      doubleTap={combo.doubleTap}
      className="inline-flex shrink-0 gap-0.5 self-center"
      separatorClassName="text-[10px] text-muted-foreground"
    />
  )
}
