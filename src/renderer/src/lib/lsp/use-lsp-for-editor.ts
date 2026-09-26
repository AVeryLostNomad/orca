import { useEffect, useState } from 'react'
import type { editor } from 'monaco-editor'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'
import { useAppStore } from '@/store'
import { monaco } from '@/lib/monaco-setup'
import { getConnectionIdForFile } from '@/lib/connection-context'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import { acquireLspSession, type LspSessionLease } from './lsp-client'
import { ensureLspDocumentBinding } from './lsp-document-binding'
import { ensureLspDiagnosticsSubscription } from './lsp-diagnostics-markers'
import { ensureLspProvidersForLanguage } from './lsp-monaco-providers'
import {
  disableBuiltInFeaturesForLspServer,
  lspServerForLanguageIfEnabled
} from './lsp-language-support'
import { installLspEditorOpener } from './lsp-editor-opener'
import { resolveLspProjectServerOverride } from './lsp-angular-project-detect'

function resolveLocalWorkspaceRoot(worktreeId: string): string | null {
  const state = useAppStore.getState()
  const scope = parseWorkspaceKey(worktreeId)
  if (scope?.type === 'folder') {
    const workspace = state.folderWorkspaces.find(
      (candidate) => candidate.id === scope.folderWorkspaceId
    )
    return workspace && !workspace.connectionId ? workspace.folderPath : null
  }
  return findWorktreeById(state.worktreesByRepo, worktreeId)?.path ?? null
}

export type EditorLspStatus =
  | { phase: 'idle' }
  | { phase: 'installing'; serverId: string; progress: number }
  | { phase: 'starting'; serverId: string }
  | { phase: 'error'; serverId: string; message: string }

/** Attach language-server intellisense to a mounted file editor. Local
 *  workspaces only for now; remote files silently keep the basic experience.
 *  Returns transient status for the editor's chip (idle once ready). */
export function useLspForEditor(args: {
  mountedEditor: editor.IStandaloneCodeEditor | null
  filePath: string
  language: string
  documentId?: WorkingDocumentId
  worktreeId: string | undefined
}): EditorLspStatus {
  const { mountedEditor, filePath, language, worktreeId, documentId } = args
  const settings = useAppStore((s) => s.settings)
  const serverId = lspServerForLanguageIfEnabled(settings, language)
  const [status, setStatus] = useState<EditorLspStatus>({ phase: 'idle' })

  useEffect(() => {
    if (!mountedEditor || !serverId || !worktreeId) {
      setStatus({ phase: 'idle' })
      return
    }
    // Local-only: a non-null connection id means SSH/remote ownership.
    if (getConnectionIdForFile(worktreeId, filePath) !== null) {
      setStatus({ phase: 'idle' })
      return
    }
    const rootPath = resolveLocalWorkspaceRoot(worktreeId)
    if (!rootPath) {
      setStatus({ phase: 'idle' })
      return
    }
    let cancelled = false
    // May be swapped for a project-conditional server (e.g. Angular for .html).
    let activeServerId = serverId
    const unsubscribeInstallState = window.api?.lsp?.onServerStateChanged?.(
      ({ serverId: changedServerId, state }) => {
        if (cancelled || changedServerId !== activeServerId) {
          return
        }
        if (state.phase === 'installing') {
          setStatus({ phase: 'installing', serverId: activeServerId, progress: state.progress })
        }
      }
    )
    setStatus({ phase: 'starting', serverId })
    void (async () => {
      let lease: LspSessionLease | null = null
      try {
        activeServerId = await resolveLspProjectServerOverride(
          useAppStore.getState().settings,
          serverId,
          rootPath
        )
        if (cancelled) {
          return
        }
        lease = await acquireLspSession(activeServerId, rootPath)
        if (!lease) {
          if (!cancelled) {
            setStatus({
              phase: 'error',
              serverId: activeServerId,
              message: 'Language server unavailable'
            })
          }
          return
        }
        if (cancelled) {
          return
        }
        const model = mountedEditor.getModel()
        if (!model || model.isDisposed()) {
          setStatus({ phase: 'idle' })
          return
        }
        installLspEditorOpener(monaco)
        ensureLspDiagnosticsSubscription(monaco, lease.session)
        ensureLspProvidersForLanguage(monaco, language, lease.session)
        disableBuiltInFeaturesForLspServer(activeServerId)
        ensureLspDocumentBinding(model, lease, filePath, language, worktreeId, documentId)
        lease = null
        setStatus({ phase: 'idle' })
      } catch (error) {
        if (!cancelled) {
          setStatus({ phase: 'error', serverId: activeServerId, message: String(error) })
        }
      } finally {
        lease?.release()
      }
    })()
    return () => {
      cancelled = true
      unsubscribeInstallState?.()
    }
  }, [mountedEditor, filePath, language, worktreeId, documentId, serverId])
  return status
}
