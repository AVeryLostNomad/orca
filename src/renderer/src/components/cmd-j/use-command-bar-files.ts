import { useMemo } from 'react'
import type { QuickOpenSearchResult } from '@/components/quick-open-search'
import { useRuntimeFileListForWorktree } from '@/components/quick-open-file-list'
import { rankQuickOpenFilesWithHistory } from '@/components/quick-open-history-ranking'
import { useQuickOpenHistory } from '@/lib/quick-open-file-history'
import {
  isQuickOpenAbsolutePath,
  parseQuickOpenQueryTarget,
  type QuickOpenQueryTarget
} from '../../../../shared/quick-open-query-target'

export type CommandBarFilesResult = {
  items: QuickOpenSearchResult[]
  loading: boolean
  loadError: string | null
  /** Parsed `path:line:col` target used when opening a selected file. */
  target: QuickOpenQueryTarget
}

/** Ranked workspace files for the command bar's Files section (absorbed QuickOpen). */
export function useCommandBarFiles(args: {
  enabled: boolean
  worktreeId: string | null
  worktreePath: string | null
  query: string
  limit: number
}): CommandBarFilesResult {
  const { worktreeId, worktreePath, query, limit } = args
  // Why: web/preview shells (and partial test harnesses) may not expose the
  // file-listing API; the section simply stays absent there.
  const fileListingAvailable = typeof window !== 'undefined' && window.api?.fs != null
  const enabled = args.enabled && fileListingAvailable
  const parsedTarget = useMemo(() => parseQuickOpenQueryTarget(query), [query])
  const absoluteQuery = isQuickOpenAbsolutePath(parsedTarget.pathQuery)
  const history = useQuickOpenHistory(worktreeId, worktreePath)
  const { files, loading, loadError } = useRuntimeFileListForWorktree({
    enabled: enabled && !absoluteQuery,
    worktreeId,
    query: parsedTarget.pathQuery,
    recentPaths: history
  })
  // A literal path containing `:N` should match itself rather than parse as a line target.
  const target = useMemo(
    () => (files.includes(query.trim()) ? { pathQuery: query.trim() } : parsedTarget),
    [files, query, parsedTarget]
  )
  const items = useMemo(() => {
    if (!enabled) {
      return []
    }
    if (absoluteQuery) {
      return [{ path: parsedTarget.pathQuery, score: 0 }]
    }
    return rankQuickOpenFilesWithHistory(target.pathQuery, files, history).slice(0, limit)
  }, [enabled, absoluteQuery, parsedTarget.pathQuery, target.pathQuery, files, history, limit])
  return {
    items,
    loading: loading && !absoluteQuery,
    loadError: absoluteQuery ? null : loadError,
    target
  }
}
