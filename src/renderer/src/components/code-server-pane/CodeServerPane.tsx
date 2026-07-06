import { useEffect, useRef, useState } from 'react'
import { SquareCode } from 'lucide-react'
import { useAppStore } from '../../store'
import type { CodeServerStatusEvent } from '../../../../shared/code-server-types'
import {
  buildCodeServerUrl,
  destroyCodeServerWebview,
  ensureCodeServerWebview
} from './code-server-webview'

type Props = {
  codeServerTabId: string
  worktreeId: string
  isActive: boolean
}

export default function CodeServerPane({ codeServerTabId, worktreeId }: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const tab = useAppStore((s) =>
    (s.codeServerTabsByWorktree[worktreeId] ?? []).find((t) => t.id === codeServerTabId)
  )
  const setCodeServerStatus = useAppStore((s) => s.setCodeServerStatus)
  const [status, setStatus] = useState<CodeServerStatusEvent>({ status: 'starting', port: null })

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
      }
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
    const { webview, created } = ensured
    const handleFailLoad = (event: { errorCode?: number; isMainFrame?: boolean }): void => {
      if (event.isMainFrame === false || event.errorCode === -3) {
        return
      }
      setStatus({ status: 'error', port: status.port, error: 'code-server failed to load.' })
    }
    webview.addEventListener('did-fail-load', handleFailLoad)
    if (created) {
      webview.src = buildCodeServerUrl(status.port, tab.folderPath)
    }
    return () => {
      webview.removeEventListener('did-fail-load', handleFailLoad)
    }
  }, [status, tab, codeServerTabId])

  const retry = (): void => {
    void window.api.codeServer.ensureRunning().then((result) => {
      if ('error' in result) {
        setStatus({ status: 'error', port: null, error: result.error })
      }
    })
  }

  return (
    <div className="flex flex-1 flex-col bg-editor-surface">
      {status.status === 'ready' ? (
        <div ref={containerRef} className="flex flex-1" />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <SquareCode className="size-8" />
          {status.status === 'installing' ? (
            <span>Installing VS Code… {Math.round((status.progress ?? 0) * 100)}%</span>
          ) : status.status === 'error' ? (
            <div className="flex flex-col items-center gap-2">
              <span>{status.error ?? 'Something went wrong.'}</span>
              <button className="underline" onClick={retry}>
                Retry
              </button>
              <a
                className="text-xs underline"
                href="https://coder.com/docs/code-server/install"
                target="_blank"
                rel="noreferrer"
              >
                Manual install instructions
              </a>
            </div>
          ) : (
            <span>Starting VS Code…</span>
          )}
        </div>
      )}
    </div>
  )
}
