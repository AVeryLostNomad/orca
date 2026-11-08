import { useEffect } from 'react'
import type { editor } from 'monaco-editor'
import { useAppStore } from '@/store'
import { monaco } from '@/lib/monaco-setup'
import { getConnectionIdForFile } from '@/lib/connection-context'
import { addOpenUnityDocsAction } from './unity-docs'
import { attachUnityModelInsight } from './unity-insight-model-state'
import { ensureUnityMonacoProviders } from './unity-monaco-providers'

/** Workspace root implied by an absolute path and its workspace-relative path. */
function workspaceRootOf(filePath: string, relativePath: string): string | null {
  const absolute = filePath.replace(/\\/g, '/')
  const relative = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!relative || !absolute.toLowerCase().endsWith(`/${relative.toLowerCase()}`)) {
    return null
  }
  return filePath.slice(0, filePath.length - relative.length - 1)
}

/** Rider-style Unity insight (event functions, inspections, asset lenses) for local C# files
 *  inside a Unity project. Remote files and non-Unity C# keep the plain experience. */
export function useUnityInsightForEditor(args: {
  mountedEditor: editor.IStandaloneCodeEditor | null
  filePath: string
  relativePath: string
  language: string
  worktreeId: string | undefined
}): void {
  const { mountedEditor, filePath, relativePath, language, worktreeId } = args
  const enabled = useAppStore((s) => s.settings?.unityIntegrationEnabled !== false)

  useEffect(() => {
    if (!enabled || !mountedEditor || language !== 'csharp' || !worktreeId || !window.api?.unity) {
      return
    }
    if (getConnectionIdForFile(worktreeId, filePath) !== null) {
      return
    }
    let cancelled = false
    let release: (() => void) | null = null
    let docsAction: { dispose: () => void } | null = null
    void window.api.unity
      .getProjectInfo({ path: filePath })
      .catch(() => null)
      .then((project) => {
        const model = mountedEditor.getModel()
        if (cancelled || !project || !model || model.isDisposed()) {
          return
        }
        ensureUnityMonacoProviders(monaco)
        release = attachUnityModelInsight(monaco, model, {
          filePath,
          worktreeId,
          workspaceRoot: workspaceRootOf(filePath, relativePath),
          project
        })
        docsAction = addOpenUnityDocsAction(monaco, mountedEditor)
      })
    return () => {
      cancelled = true
      release?.()
      docsAction?.dispose()
    }
  }, [enabled, mountedEditor, filePath, relativePath, language, worktreeId])
}
