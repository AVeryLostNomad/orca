import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useState } from 'react'

type UseFileExplorerNameFilterResult = {
  nameFilterQuery: string
  setNameFilterQuery: Dispatch<SetStateAction<string>>
  hasNameFilter: boolean
  handleClearNameFilter: () => void
}

/**
 * Files-view name-filter query state. The query drives the tree model's own
 * search session, so no separate file-list fetch is needed.
 */
export function useFileExplorerNameFilter({
  isFilesViewActive
}: {
  isFilesViewActive: boolean
}): UseFileExplorerNameFilterResult {
  const [nameFilterQuery, setNameFilterQuery] = useState('')
  const hasNameFilter = isFilesViewActive && nameFilterQuery.trim().length > 0
  const handleClearNameFilter = useCallback(() => {
    setNameFilterQuery('')
  }, [])

  return { nameFilterQuery, setNameFilterQuery, hasNameFilter, handleClearNameFilter }
}
