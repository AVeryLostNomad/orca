import { ORCA_VSCODE_PARTITION } from '../../shared/constants'
import { installBrowserSessionPartitionPolicies } from '../browser/browser-session-partition-policies'

/** The embedded code-server guest needs the same permission/download hardening as browser sessions. */
export function installCodeServerPartitionPolicies(): void {
  void installBrowserSessionPartitionPolicies({
    id: 'vscode',
    scope: 'isolated',
    partition: ORCA_VSCODE_PARTITION,
    label: 'VS Code',
    source: null
  }).catch(() => {
    console.warn('[code-server] Failed to install VS Code partition policies')
  })
}
