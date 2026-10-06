/** Account pins a project can set itself or inherit from its project group chain. */
export const PROJECT_ACCOUNT_PIN_FIELDS = [
  'githubAccountRef',
  'claudeAccountId',
  'codexAccountId'
] as const

export type ProjectAccountPinField = (typeof PROJECT_ACCOUNT_PIN_FIELDS)[number]

/** Absent/null = inherit (projects from their group, groups from their parent group). */
export type ProjectAccountPins = Partial<Record<ProjectAccountPinField, string | null>>

export type ProjectAccountPinSource =
  | { kind: 'project' }
  | { kind: 'group'; groupId: string; groupName: string }
  | { kind: 'none' }

export type ResolvedProjectAccountPin = {
  value: string | null
  source: ProjectAccountPinSource
}

export function isProjectAccountPinField(value: unknown): value is ProjectAccountPinField {
  return (PROJECT_ACCOUNT_PIN_FIELDS as readonly unknown[]).includes(value)
}
