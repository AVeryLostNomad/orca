import { useEffect, useState } from 'react'
import type { editor } from 'monaco-editor'
import { useAppStore } from '@/store'
import { monaco } from '@/lib/monaco-setup'
import { getConnectionIdForFile } from '@/lib/connection-context'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import { ensureLspSession } from './lsp-client'
import { getLspIpcTransport } from './lsp-ipc-transport'
import { ensureLspDocumentBinding } from './lsp-document-binding'
import { ensureLspDiagnosticsSubscription } from './lsp-diagnostics-markers'
import { ensureLspProvidersForLanguage } from './lsp-monaco-providers'
import {
  disableBuiltInFeaturesForLspServer,
  lspServerForLanguageIfEnabled
} from './lsp-language-support'
import { installLspEditorOpener } from './lsp-editor-opener'

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
  worktreeId: string | undefined
}): EditorLspStatus {
  const { mountedEditor, filePath, language, worktreeId } = args
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
    let ensuredSessionId: string | null = null
    const unsubscribeInstallState = window.api?.lsp?.onServerStateChanged?.(
      ({ serverId: changedServerId, state }) => {
        if (cancelled || changedServerId !== serverId) {
          return
        }
        if (state.phase === 'installing') {
          setStatus({ phase: 'installing', serverId, progress: state.progress })
        }
      }
    )
    setStatus({ phase: 'starting', serverId })
    void (async () => {
      const session = await ensureLspSession(serverId, rootPath)
      if (!session) {
        if (!cancelled) {
          setStatus({ phase: 'error', serverId, message: 'Language server unavailable' })
        }
        return
      }
      ensuredSessionId = session.sessionId
      if (cancelled) {
        return
      }
      const model = mountedEditor.getModel()
      if (!model || model.isDisposed()) {
        setStatus({ phase: 'idle' })
        return
      }
      installLspEditorOpener(monaco)
      ensureLspDiagnosticsSubscription(monaco, session)
      ensureLspProvidersForLanguage(monaco, language, session)
      disableBuiltInFeaturesForLspServer(serverId)
      ensureLspDocumentBinding(model, session, filePath, language, worktreeId)
      setStatus({ phase: 'idle' })
    })()
    return () => {
      cancelled = true
      unsubscribeInstallState?.()
      // Ref-count release only — the document binding stays with the retained
      // model so tab switches keep the server context warm.
      if (ensuredSessionId) {
        void getLspIpcTransport()?.releaseSession(ensuredSessionId)
      }
    }
  }, [mountedEditor, filePath, language, worktreeId, serverId])

  return status
}
