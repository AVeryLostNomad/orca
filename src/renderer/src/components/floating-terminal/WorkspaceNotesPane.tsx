import { Suspense, useEffect, useRef, useState } from 'react'
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import { ORCA_EDITOR_SAVE_AND_CLOSE_EVENT } from '@/components/editor/editor-autosave'
import { resolveWorkspaceDisplayName } from '@/lib/floating-workspace-notes-tab'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'

const EditorPanel = lazy(() => import('@/components/editor/EditorPanel'))

/** Save-then-close through the app-wide autosave controller so a still-debounced draft is flushed, not dropped. */
function requestNotesFileSaveAndClose(fileId: string): void {
  window.dispatchEvent(new CustomEvent(ORCA_EDITOR_SAVE_AND_CLOSE_EVENT, { detail: { fileId } }))
}

/** Permanent scratchpad surface: renders the selected workspace's notes file, or a
 *  placeholder when no workspace is selected. The notes OpenFile is tab-less
 *  (suppressUnifiedTab) — this pane is its only surface. */
export function WorkspaceNotesPane({ open }: { open: boolean }): React.JSX.Element {
  // The floating sentinel is not a real workspace; treat it like "nothing selected".
  const activeWorkspaceId = useAppStore((s) =>
    s.activeWorktreeId && s.activeWorktreeId !== FLOATING_TERMINAL_WORKTREE_ID
      ? s.activeWorktreeId
      : null
  )
  const [notesFile, setNotesFile] = useState<{ ownerId: string; fileId: string } | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  // Why: workspace clicks can outpace the ensure IPC; only the newest request may commit state.
  const requestGenerationRef = useRef(0)

  useEffect(() => {
    if (!open) {
      return
    }
    const generation = ++requestGenerationRef.current
    setUnavailable(false)
    const state = useAppStore.getState()
    // Flush-and-close notes owned by other workspaces — covers swaps and stale rehydrated files.
    for (const file of state.openFiles) {
      if (
        file.worktreeId === FLOATING_TERMINAL_WORKTREE_ID &&
        file.workspaceNotesOwnerId &&
        file.workspaceNotesOwnerId !== activeWorkspaceId
      ) {
        requestNotesFileSaveAndClose(file.id)
      }
    }
    if (!activeWorkspaceId) {
      setNotesFile(null)
      return
    }
    const ensureWorkspaceNotesFile = window.api?.app?.ensureWorkspaceNotesFile
    if (!ensureWorkspaceNotesFile) {
      setUnavailable(true)
      setNotesFile(null)
      return
    }
    void ensureWorkspaceNotesFile({
      workspaceId: activeWorkspaceId,
      displayName: resolveWorkspaceDisplayName(state, activeWorkspaceId)
    })
      .then((result) => {
        if (requestGenerationRef.current !== generation) {
          return
        }
        if (!result) {
          setUnavailable(true)
          setNotesFile(null)
          return
        }
        const fileId = useAppStore.getState().openFile(
          {
            filePath: result.filePath,
            relativePath: 'notes.md',
            worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
            language: 'markdown',
            mode: 'edit',
            runtimeEnvironmentId: null,
            alwaysAutoSave: true,
            workspaceNotesOwnerId: activeWorkspaceId
          },
          { preview: false, suppressUnifiedTab: true, suppressActiveRuntimeFallback: true }
        )
        setNotesFile({ ownerId: activeWorkspaceId, fileId })
      })
      .catch(() => {
        if (requestGenerationRef.current === generation) {
          setUnavailable(true)
          setNotesFile(null)
        }
      })
  }, [open, activeWorkspaceId])

  const showEditor = activeWorkspaceId !== null && notesFile?.ownerId === activeWorkspaceId
  return (
    <div className="absolute inset-0 flex min-h-0 min-w-0 bg-background">
      {showEditor && notesFile ? (
        <Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              {translate(
                'auto.components.floating.terminal.WorkspaceNotesPane.3f1c62a8d4',
                'Loading editor...'
              )}
            </div>
          }
        >
          {/* Why: workspace notes are scratch/local context, not a repo review surface. */}
          <EditorPanel
            activeFileId={notesFile.fileId}
            activeViewStateId={notesFile.fileId}
            isVisible={open}
            markdownAnnotationsEnabled={false}
          />
        </Suspense>
      ) : (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
          {unavailable
            ? translate(
                'auto.components.floating.terminal.WorkspaceNotesPane.b74a09e1c5',
                'Workspace notes are unavailable in this client.'
              )
            : activeWorkspaceId
              ? null
              : translate(
                  'auto.components.floating.terminal.WorkspaceNotesPane.7e5d20cf91',
                  'Click on a workspace to see workspace notes'
                )}
        </div>
      )}
    </div>
  )
}
