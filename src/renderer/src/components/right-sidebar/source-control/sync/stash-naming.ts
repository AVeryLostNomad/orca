import { translate } from '@/i18n/i18n'
import type { GitStashPushScope } from '../../../../../../shared/git-stash'

export function getStashScopeLabel(scope: GitStashPushScope): string {
  switch (scope) {
    case 'staged':
      return translate(
        'auto.components.right.sidebar.SourceControl.stashScopeStaged',
        'Staged changes'
      )
    case 'unstaged':
      return translate('auto.components.right.sidebar.SourceControl.stashScopeUnstaged', 'Changes')
    case 'untracked':
      return translate(
        'auto.components.right.sidebar.SourceControl.stashScopeUntracked',
        'Untracked files'
      )
    case 'all':
      return translate('auto.components.right.sidebar.SourceControl.stashScopeAll', 'All changes')
  }
}

/** The default name the dialog offers, e.g. "Staged changes on main". */
export function suggestStashName(scope: GitStashPushScope, branchName: string): string {
  const scopeLabel = getStashScopeLabel(scope)
  const branch = branchName.trim()
  return branch
    ? translate(
        'auto.components.right.sidebar.SourceControl.stashSuggestedName',
        '{{scope}} on {{branch}}',
        { scope: scopeLabel, branch }
      )
    : scopeLabel
}

export function describeStashError(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined
}
