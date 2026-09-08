import type { ClientHostedBrowserRow } from '../../../../shared/client-hosted-browser-rows'
import type { TabGroup } from '../../../../shared/tab-types'
import { useAppStore } from '../../store'
import { useClientHostedBrowserRows } from '@/lib/pane-manager/client-hosted-browser-row-state'
import { resolveClientHostedBrowserRowStripGroupId } from '../tab-bar/client-hosted-browser-row-strip-placement'

const EMPTY_GROUPS: readonly TabGroup[] = []
const EMPTY_CLIENT_HOSTED_ROWS: readonly ClientHostedBrowserRow[] = []

export function useClientHostedBrowserRowsForGroup(
  worktreeId: string,
  groupId: string
): readonly ClientHostedBrowserRow[] {
  const ownsClientHostedRows = useAppStore(
    (state) =>
      resolveClientHostedBrowserRowStripGroupId(
        state.groupsByWorktree[worktreeId] ?? EMPTY_GROUPS
      ) === groupId
  )
  const worktreeClientHostedRows = useClientHostedBrowserRows(worktreeId)
  return ownsClientHostedRows ? worktreeClientHostedRows : EMPTY_CLIENT_HOSTED_ROWS
}
