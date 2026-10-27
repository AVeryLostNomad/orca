import type { Tab } from '../../../../shared/tab-types'
import type { TabBarItem } from './tab-bar-item-model'

type EmbeddedTabData = { id: string; label: string }

/** VS Code (code-server) and Data Studio chips: overlay-rendered tabs keyed by their entity id. */
export function buildEmbeddedTabBarItem(
  id: string,
  codeServerMap: Map<string, EmbeddedTabData>,
  dataStudioMap: Map<string, EmbeddedTabData>,
  unifiedTabByVisibleId: Map<string, Tab>
): TabBarItem | null {
  const codeServerTab = codeServerMap.get(id)
  const data = codeServerTab ?? dataStudioMap.get(id)
  if (!data) {
    return null
  }
  const unifiedTab = unifiedTabByVisibleId.get(id)
  return {
    type: codeServerTab ? 'vscode' : 'datastudio',
    id,
    unifiedTabId: unifiedTab?.id ?? data.id,
    isPinned: unifiedTab?.isPinned === true,
    data
  }
}
