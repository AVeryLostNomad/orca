import { translate } from '@/i18n/i18n'
import type { ResolvedProjectAccountPin } from '../../../../shared/project-account-pin-types'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { labelForAccountPin, type ProjectAccountOption } from './project-account-options'

// Why: Radix Select reserves '' for "no value", so the inherit choice needs a sentinel.
const INHERIT_VALUE = '__inherit__'

/** Describes what an unpinned project/group falls back to. */
export function describeAccountPinFallback(
  inherited: ResolvedProjectAccountPin,
  options: readonly ProjectAccountOption[],
  defaultLabel: string
): string {
  if (inherited.source.kind === 'group' && inherited.value) {
    return translate(
      'auto.components.projectAccounts.inheritFromGroup',
      'Inherit from {{group}}: {{account}}',
      {
        group: inherited.source.groupName,
        account: labelForAccountPin(options, inherited.value) ?? inherited.value
      }
    )
  }
  return defaultLabel
}

export function ProjectAccountPinSelect({
  value,
  options,
  fallbackLabel,
  onChange,
  ariaLabel
}: {
  /** The project's/group's own pin; null = inherit. */
  value: string | null
  options: readonly ProjectAccountOption[]
  fallbackLabel: string
  onChange: (value: string | null) => void
  ariaLabel: string
}): React.JSX.Element {
  const isListed = !value || options.some((option) => option.value === value)
  return (
    <Select
      value={value ?? INHERIT_VALUE}
      onValueChange={(next) => onChange(next === INHERIT_VALUE ? null : next)}
    >
      <SelectTrigger className="w-full max-w-md" aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={INHERIT_VALUE}>{fallbackLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
        {value && !isListed ? (
          // Keep a removed account visible so the user can see and clear the stale pin.
          <SelectItem value={value}>
            {translate(
              'auto.components.projectAccounts.unavailableOption',
              '{{ref}} (unavailable)',
              {
                ref: value
              }
            )}
          </SelectItem>
        ) : null}
      </SelectContent>
    </Select>
  )
}
