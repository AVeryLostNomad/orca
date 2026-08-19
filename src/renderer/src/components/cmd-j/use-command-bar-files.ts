import { useMemo } from 'react'
import {
  prepareQuickOpenFiles,
  rankQuickOpenFiles,
  type QuickOpenSearchResult
} from '@/components/quick-open-search'
import { useRuntimeFileListForWorktree } from '@/components/quick-open-file-list'

export type CommandBarFilesResult = {
  items: QuickOpenSearchResult[]
  loading: boolean
  loadError: string | null
}

/** Ranked workspace files for the command bar's Files section (absorbed QuickOpen). */
export function useCommandBarFiles(args: {
  enabled: boolean
  worktreeId: string | null
  query: string
  limit: number
}): CommandBarFilesResult {
  const { worktreeId, query, limit } = args
  // Why: web/preview shells (and partial test harnesses) may not expose the
  // file-listing API; the section simply stays absent there.
  const fileListingAvailable = typeof window !== 'undefined' && window.api?.fs != null
  const enabled = args.enabled && fileListingAvailable
  const { files, loading, loadError } = useRuntimeFileListForWorktree({
    enabled,
    worktreeId
  })
  const indexedFiles = useMemo(() => prepareQuickOpenFiles(files), [files])
  const items = useMemo(
    () => (enabled ? rankQuickOpenFiles(query, indexedFiles, limit) : []),
    [enabled, query, indexedFiles, limit]
  )
  return { items, loading, loadError }
}
