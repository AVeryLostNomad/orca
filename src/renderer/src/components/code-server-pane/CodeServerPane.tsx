import { useEffect, useRef, useState } from 'react'
import { Loader2, SquareCode } from 'lucide-react'
import { useAppStore } from '../../store'
import type { CodeServerStatusEvent } from '../../../../shared/code-server-types'
import { Progress } from '../ui/progress'
import {
  buildCodeServerUrl,
  destroyCodeServerWebview,
  ensureCodeServerWebview
} from './code-server-webview'
import { translate } from '@/i18n/i18n'

type Props = {
  codeServerTabId: string
  worktreeId: string
}

export default function CodeServerPane({ codeServerTabId, worktreeId }: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const tab = useAppStore((s) =>
    (s.codeServerTabsByWorktree[worktreeId] ?? []).find((t) => t.id === codeServerTabId)
  )
  const setCodeServerStatus = useAppStore((s) => s.setCodeServerStatus)
  const [status, setStatus] = useState<CodeServerStatusEvent>({ status: 'starting', port: null })
  // Tracks the URL last written to webview.src so a crash-restart on a new
  // port (ready -> error -> ready) reloads the webview without thrashing
  // src on unrelated re-renders that resolve to the same URL.
  const lastAppliedUrlRef = useRef<string | null>(null)

  // Subscribe to lifecycle changes + mirror into the store.
  useEffect(() => {
    const unsubscribe = window.api.codeServer.onStatusChanged((event) => {
      setStatus(event)
      setCodeServerStatus(event)
    })
    return unsubscribe
  }, [setCodeServerStatus])

  // Acquire on mount, release on unmount (refcount drives shared-server lifetime).
  useEffect(() => {
    let released = false
    void window.api.codeServer.ensureRunning().then((result) => {
      if ('error' in result) {
        setStatus({ status: 'error', port: null, error: result.error })
        return
      }
      // acquire resolves with the port only once the shared server is ready. A
      // pane mounting after another worktree already started the server never
      // receives a 'ready' broadcast (acquire returns early without emitting),
      // so seed ready state from the result or it hangs on "Starting VS Code…".
      setStatus((prev) => (prev.status === 'ready' ? prev : { status: 'ready', port: result.port }))
    })
    return () => {
      if (!released) {
        released = true
        destroyCodeServerWebview(codeServerTabId)
        void window.api.codeServer.release()
      }
    }
  }, [codeServerTabId])

  // Once ready, create the webview and point it at the folder.
  useEffect(() => {
    if (status.status !== 'ready' || status.port == null || !tab) {
      return
    }
    const container = containerRef.current
    if (!container) {
      return
    }
    const ensured = ensureCodeServerWebview({ codeServerTabId, container })
    if (!ensured) {
      return
    }
    const { webview } = ensured
    const handleFailLoad = (event: { errorCode?: number; isMainFrame?: boolean }): void => {
      if (event.isMainFrame === false || event.errorCode === -3) {
        return
      }
      setStatus({
        status: 'error',
        port: status.port,
        error: translate(
          'auto.components.code.server.pane.CodeServerPane.231da812b0',
          'code-server failed to load.'
        )
      })
    }
    webview.addEventListener('did-fail-load', handleFailLoad)
    // Recompute on every ready transition (not just webview creation) so a
    // shared-server crash-restart on a different port is picked up here.
    const targetUrl = buildCodeServerUrl(status.port, tab.folderPath)
    if (lastAppliedUrlRef.current !== targetUrl) {
      webview.src = targetUrl
      lastAppliedUrlRef.current = targetUrl
    }
    return () => {
      webview.removeEventListener('did-fail-load', handleFailLoad)
    }
  }, [status, tab, codeServerTabId])

  const retry = (): void => {
    // Non-refcounting re-drive: the mount effect already acquired one ref, so
    // reusing ensureRunning here would inflate refCount and keep the shared
    // server alive after the last vscode tab closes.
    void window.api.codeServer.retry().then((result) => {
      if ('error' in result) {
        setStatus({ status: 'error', port: null, error: result.error })
        return
      }
      // Same as the mount path: if retry finds the server already ready it
      // resolves without a broadcast, so seed ready from the result.
      setStatus((prev) => (prev.status === 'ready' ? prev : { status: 'ready', port: result.port }))
    })
  }

  return (
    <div className="flex flex-1 flex-col bg-editor-surface">
      {status.status === 'ready' ? (
        <div ref={containerRef} className="flex flex-1" />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          {status.status === 'installing' ? (
            <div className="flex w-48 flex-col items-center gap-2">
              <span className="text-sm">
                {translate(
                  'auto.components.code.server.pane.CodeServerPane.4a8a282725',
                  'Installing VS Code…'
                )}{' '}
                {Math.round((status.progress ?? 0) * 100)}%
              </span>
              <Progress value={Math.round((status.progress ?? 0) * 100)} className="h-1.5" />
            </div>
          ) : status.status === 'error' ? (
            <div className="flex flex-col items-center gap-2">
              <SquareCode className="size-8" />
              <span>{status.error ?? 'Something went wrong.'}</span>
              <button className="underline" onClick={retry}>
                {translate('auto.components.code.server.pane.CodeServerPane.1d7589e99e', 'Retry')}
              </button>
              <a
                className="text-xs underline"
                href="https://coder.com/docs/code-server/install"
                target="_blank"
                rel="noreferrer"
              >
                {translate(
                  'auto.components.code.server.pane.CodeServerPane.3d3fe86c25',
                  'Manual install instructions'
                )}
              </a>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" />
              <span className="text-sm">
                {translate(
                  'auto.components.code.server.pane.CodeServerPane.6f17119460',
                  'Starting VS Code…'
                )}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
