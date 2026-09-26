import { useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import { detectLanguage } from '@/lib/language-detect'
import { joinPath } from '@/lib/path'
import type { OpenFile } from '@/store/slices/editor'
import {
  buildWorkingDocumentTarget,
  type WorkingDocumentId
} from '@/store/slices/editor/working-document'
import type { DiffSection } from '../diff-section-types'
import { loadWorkingDocument } from '../working-document-loader'

/**
 * Combined tabs own retained working-document membership. A row only joins after its text diff
 * has been loaded, so collapsed and virtualized rows never trigger a filesystem read merely by
 * appearing in the tree.
 */
export function useCombinedDiffWorkingDocuments({
  file,
  sections,
  tabId
}: {
  file: OpenFile
  sections: readonly DiffSection[]
  tabId: string
}): Readonly<Record<string, WorkingDocumentId>> {
  const retainWorkingDocument = useAppStore((state) => state.retainWorkingDocument)
  const [documentIdsBySectionKey, setDocumentIdsBySectionKey] = useState<
    Readonly<Record<string, WorkingDocumentId>>
  >({})

  useEffect(() => {
    if (file.diffSource !== 'combined-uncommitted' && file.diffSource !== 'combined-all') {
      return
    }

    const admitted: Record<string, WorkingDocumentId> = {}
    const state = useAppStore.getState()
    for (const section of sections) {
      if (
        (section.area !== 'unstaged' && section.area !== 'untracked') ||
        section.submodule !== undefined ||
        section.submoduleRoot !== undefined ||
        section.error !== undefined ||
        section.diffResult?.kind !== 'text' ||
        section.largeDiffRenderLimit?.limited
      ) {
        continue
      }

      try {
        const target = buildWorkingDocumentTarget(state, {
          ...file,
          filePath: joinPath(file.filePath, section.path),
          relativePath: section.path,
          language: detectLanguage(section.path)
        })
        const documentId = retainWorkingDocument(tabId, target)
        admitted[section.key] = documentId
        const document = useAppStore.getState().workingDocuments[documentId]
        if (document?.loadState === 'unloaded') {
          void loadWorkingDocument(documentId).catch(() => undefined)
        }
      } catch {
        // An unresolved or stale owner route must stay read-only; never fall back to local IO.
      }
    }

    if (Object.keys(admitted).length === 0) {
      return
    }
    setDocumentIdsBySectionKey((current) => {
      let changed = false
      const next = { ...current }
      for (const [key, id] of Object.entries(admitted)) {
        if (next[key] !== id) {
          next[key] = id
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [file, retainWorkingDocument, sections, tabId])

  return documentIdsBySectionKey
}
