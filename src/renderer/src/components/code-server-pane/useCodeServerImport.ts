import { useCallback, useState } from 'react'
import type {
  CodeServerImportSourceId,
  CodeServerImportState
} from '../../../../shared/code-server-types'
import { useMountedRef } from '../../hooks/useMountedRef'

export type CodeServerImportApplied = {
  extensionsImported: number
  extensionsSkipped: number
  restarted: boolean
}

export type UseCodeServerImportReturn = {
  open: boolean
  state: CodeServerImportState | null
  loading: boolean
  applying: boolean
  applied: CodeServerImportApplied | null
  applyError: string | null
  selectedSourceId: CodeServerImportSourceId | null
  setSelectedSourceId: (id: CodeServerImportSourceId) => void
  includeExtensions: boolean
  setIncludeExtensions: (value: boolean) => void
  openImport: () => Promise<void>
  maybeOpenFirstRun: () => Promise<void>
  handleApply: () => Promise<void>
  handleOpenChange: (open: boolean) => void
}

// One first-run check per app session: several panes can reach 'ready' (one per
// worktree with a VS Code tab) and each would otherwise race to open the prompt.
let firstRunPromptChecked = false

export function resetCodeServerImportFirstRunForTests(): void {
  firstRunPromptChecked = false
}

function defaultSourceId(state: CodeServerImportState): CodeServerImportSourceId | null {
  const preferred = state.activeSourceId ?? 'vscode'
  return state.sources.find((s) => s.id === preferred)?.id ?? state.sources[0]?.id ?? null
}

export function useCodeServerImport(): UseCodeServerImportReturn {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<CodeServerImportState | null>(null)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState<CodeServerImportApplied | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [selectedSourceId, setSelectedSourceId] = useState<CodeServerImportSourceId | null>(null)
  const [includeExtensions, setIncludeExtensions] = useState(true)
  const mountedRef = useMountedRef()

  const loadState = useCallback(async (): Promise<CodeServerImportState | null> => {
    setLoading(true)
    try {
      const result = await window.api.codeServer.getImportState()
      if (mountedRef.current) {
        setState(result)
        const initial = defaultSourceId(result)
        setSelectedSourceId(initial)
        setIncludeExtensions(
          (result.sources.find((s) => s.id === initial)?.extensionCount ?? 0) > 0
        )
      }
      return result
    } catch {
      return null
    } finally {
      if (mountedRef.current) {
        setLoading(false)
      }
    }
  }, [mountedRef])

  const openImport = useCallback(async (): Promise<void> => {
    setOpen(true)
    await loadState()
  }, [loadState])

  // Auto-open once per install when the user has never chosen a source nor
  // dismissed the prompt, and there is something detectable to import.
  const maybeOpenFirstRun = useCallback(async (): Promise<void> => {
    if (firstRunPromptChecked) {
      return
    }
    firstRunPromptChecked = true
    const result = await loadState()
    if (
      result &&
      !result.promptDismissed &&
      result.activeSourceId == null &&
      result.sources.length > 0 &&
      mountedRef.current
    ) {
      setOpen(true)
    }
  }, [loadState, mountedRef])

  async function handleApply(): Promise<void> {
    if (!selectedSourceId || applying || applied) {
      return
    }
    setApplying(true)
    setApplyError(null)
    try {
      const result = await window.api.codeServer.applyImport({
        sourceId: selectedSourceId,
        includeExtensions
      })
      if (!mountedRef.current) {
        return
      }
      if ('error' in result) {
        setApplyError(result.error)
        return
      }
      setApplied(result)
    } catch (err) {
      if (mountedRef.current) {
        setApplyError(err instanceof Error ? err.message : 'Import failed')
      }
    } finally {
      if (mountedRef.current) {
        setApplying(false)
      }
    }
  }

  function handleOpenChange(newOpen: boolean): void {
    setOpen(newOpen)
    if (!newOpen) {
      if (!applied) {
        // Closing without importing counts as dismissing the first-run prompt.
        void window.api.codeServer.dismissImportPrompt()
      }
      setApplied(null)
      setApplyError(null)
      setApplying(false)
    }
  }

  return {
    open,
    state,
    loading,
    applying,
    applied,
    applyError,
    selectedSourceId,
    setSelectedSourceId,
    includeExtensions,
    setIncludeExtensions,
    openImport,
    maybeOpenFirstRun,
    handleApply,
    handleOpenChange
  }
}
