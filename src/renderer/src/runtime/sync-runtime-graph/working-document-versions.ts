import type { AppState } from '@/store/types'
import { stableHashString } from './editor-draft-hash'
import { graphState } from './graph-state'
import type { WorkingDocumentVersionCacheEntry } from './types'

/** Projects canonical document revisions onto the existing tab-oriented mobile contract. */
export function getWorkingDocumentVersionByFileId(state: AppState): ReadonlyMap<string, string> {
  const cached = graphState.cachedWorkingDocumentVersions
  if (
    cached?.documentsSource === state.workingDocuments &&
    cached.membershipsSource === state.workingDocumentIdsByTab &&
    cached.openFilesSource === state.openFiles &&
    cached.unifiedTabsSource === state.unifiedTabsByWorktree
  ) {
    return cached.versions
  }

  const entries = new Map<string, WorkingDocumentVersionCacheEntry>()
  const versions = new Map<string, string>()
  // Index tab ids by entity once; a per-file scan of every tab is quadratic in large workspaces.
  const tabIdsByEntityId = new Map<string, string[]>()
  const hasDocuments = Object.keys(state.workingDocuments).length > 0
  if (hasDocuments) {
    for (const tabs of Object.values(state.unifiedTabsByWorktree ?? {})) {
      for (const tab of tabs) {
        const ids = tabIdsByEntityId.get(tab.entityId)
        if (ids) {
          ids.push(tab.id)
        } else {
          tabIdsByEntityId.set(tab.entityId, [tab.id])
        }
      }
    }
  }
  for (const file of hasDocuments ? state.openFiles : []) {
    const tabIds = [file.id, ...(tabIdsByEntityId.get(file.id) ?? [])]
    const documentId = tabIds
      .flatMap((tabId) => state.workingDocumentIdsByTab[tabId] ?? [])
      .find((id) => state.workingDocuments[id] !== undefined)
    const document = documentId ? state.workingDocuments[documentId] : undefined
    if (!document) {
      continue
    }
    const cachedEntry = cached?.entries.get(document.id)
    const entry =
      cachedEntry?.document === document
        ? cachedEntry
        : { document, version: `${document.revision}:${stableHashString(document.content ?? '')}` }
    entries.set(document.id, entry)
    versions.set(file.id, entry.version)
  }
  graphState.cachedWorkingDocumentVersions = {
    documentsSource: state.workingDocuments,
    membershipsSource: state.workingDocumentIdsByTab,
    openFilesSource: state.openFiles,
    unifiedTabsSource: state.unifiedTabsByWorktree,
    entries,
    versions
  }
  return versions
}
