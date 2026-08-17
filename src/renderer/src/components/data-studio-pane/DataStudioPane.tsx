import { useEffect, useRef, useState } from 'react'
import { Database, Loader2 } from 'lucide-react'
import { useAppStore } from '../../store'
import type { DataStudioStatusEvent } from '../../../../shared/data-studio-types'
import {
  buildDataStudioUrl,
  destroyDataStudioWebview,
  ensureDataStudioWebview
} from './data-studio-webview'
import { translate } from '@/i18n/i18n'

type Props = {
  dataStudioTabId: string
  worktreeId: string
}

export default function DataStudioPane({ dataStudioTabId, worktreeId }: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const tab = useAppStore((s) =>
    (s.dataStudioTabsByWorktree[worktreeId] ?? []).find((t) => t.id === dataStudioTabId)
  )
  const setDataStudioStatus = useAppStore((s) => s.setDataStudioStatus)
  const repoId = tab?.repoId ?? null
  const [status, setStatus] = useState<DataStudioStatusEvent>({
    repoId: repoId ?? '',
    status: 'starting',
    port: null
  })
  // The per-repo webview partition arrives with ensureRunning's result; the
  // webview cannot exist before it's known.
  const [partition, setPartition] = useState<string | null>(null)
  // Tracks the URL last written to webview.src so a crash-restart on a new
  // port (ready -> error -> ready) reloads the webview without thrashing
  // src on unrelated re-renders that resolve to the same URL.
  const lastAppliedUrlRef = useRef<string | null>(null)

  // Subscribe to lifecycle changes for THIS repo's server + mirror into the store.
  useEffect(() => {
    if (!repoId) {
      return
    }
    const unsubscribe = window.api.dataStudio.onStatusChanged((event) => {
      setDataStudioStatus(event)
      if (event.repoId === repoId) {
        setStatus(event)
      }
    })
    return unsubscribe
  }, [repoId, setDataStudioStatus])

  // Acquire on mount, release on unmount (refcount drives the per-repo server lifetime).
  useEffect(() => {
    if (!repoId) {
      return
    }
    let released = false
    // The repo's main path is only a profile breadcrumb (hash is one-way);
    // read it imperatively so its changes never re-acquire (double-ref).
    const repoPath = useAppStore.getState().repos.find((r) => r.id === repoId)?.path ?? null
    void window.api.dataStudio
      .ensureRunning({ repoId, ...(repoPath ? { repoPath } : {}) })
      .then((result) => {
        if ('error' in result) {
          setStatus({ repoId, status: 'error', port: null, error: result.error })
          return
        }
        setPartition(result.partition)
        // acquire resolves with the port only once the repo's server is ready. A
        // pane mounting after a sibling worktree already started it never
        // receives a 'ready' broadcast (acquire returns early without emitting),
        // so seed ready state from the result or it hangs on the spinner.
        setStatus((prev) =>
          prev.status === 'ready' ? prev : { repoId, status: 'ready', port: result.port }
        )
      })
    return () => {
      if (!released) {
        released = true
        destroyDataStudioWebview(dataStudioTabId)
        void window.api.dataStudio.release({ repoId })
      }
    }
  }, [dataStudioTabId, repoId])

  // Once ready, create the webview and point it at the worktree folder.
  useEffect(() => {
    if (status.status !== 'ready' || status.port == null || !tab || !partition) {
      return
    }
    const container = containerRef.current
    if (!container) {
      return
    }
    const ensured = ensureDataStudioWebview({ dataStudioTabId, container, partition })
    if (!ensured) {
      return
    }
    const { webview } = ensured
    const handleFailLoad = (event: { errorCode?: number; isMainFrame?: boolean }): void => {
      if (event.isMainFrame === false || event.errorCode === -3) {
        return
      }
      setStatus({
        repoId: status.repoId,
        status: 'error',
        port: status.port,
        error: translate(
          'auto.components.data.studio.pane.DataStudioPane.6dfe584357',
          'Data Studio failed to load.'
        )
      })
    }
    webview.addEventListener('did-fail-load', handleFailLoad)
    // Recompute on every ready transition (not just webview creation) so a
    // crash-restart of the repo's server is picked up here.
    const targetUrl = buildDataStudioUrl(status.port, tab.folderPath)
    if (lastAppliedUrlRef.current !== targetUrl) {
      webview.src = targetUrl
      lastAppliedUrlRef.current = targetUrl
    }
    return () => {
      webview.removeEventListener('did-fail-load', handleFailLoad)
    }
  }, [status, tab, dataStudioTabId, partition])

  const retry = (): void => {
    if (!repoId) {
      return
    }
    // Non-refcounting re-drive: the mount effect already acquired one ref, so
    // reusing ensureRunning here would inflate refCount and keep the repo's
    // server alive after the last Data Studio tab closes.
    void window.api.dataStudio.retry({ repoId }).then((result) => {
      if ('error' in result) {
        setStatus({ repoId, status: 'error', port: null, error: result.error })
        return
      }
      setPartition(result.partition)
      // Same as the mount path: if retry finds the server already ready it
      // resolves without a broadcast, so seed ready from the result.
      setStatus((prev) =>
        prev.status === 'ready' ? prev : { repoId, status: 'ready', port: result.port }
      )
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
                  'auto.components.data.studio.pane.DataStudioPane.160f61c356',
                  'Installing Data Studio…'
                )}{' '}
                {Math.round((status.progress ?? 0) * 100)}%
              </span>
            </div>
          ) : status.status === 'error' ? (
            <div className="flex flex-col items-center gap-2">
              <Database className="size-8" />
              <span>
                {status.error ??
                  translate(
                    'auto.components.data.studio.pane.DataStudioPane.9c7b7b091e',
                    'Something went wrong.'
                  )}
              </span>
              <button className="underline" onClick={retry}>
                {translate('auto.components.data.studio.pane.DataStudioPane.73e18cb54e', 'Retry')}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" />
              <span className="text-sm">
                {translate(
                  'auto.components.data.studio.pane.DataStudioPane.daf4265008',
                  'Starting Data Studio…'
                )}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
