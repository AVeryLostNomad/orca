import { useCallback, useEffect, useRef } from 'react'
import { monaco } from '@/lib/monaco-setup'
import { disposeUnattachedMonacoModelPaths } from './diff-monaco-model-disposal'

// Why: virtualized section rows own their snapshot model paths, while a live
// working document model belongs to the document registry and can outlive any
// one combined-diff section.
export function useDiffSectionModelLifecycle(params: {
  modelPathBase: string
  modifiedModelPath?: string
  collapsed: boolean
}): {
  disposeDiffModels: () => void
  setSectionRootNode: (node: HTMLDivElement | null) => void
} {
  const disposeDiffModels = useCallback(() => {
    window.setTimeout(() => {
      const snapshotPaths = [`${params.modelPathBase}:original`]
      if (!params.modifiedModelPath) {
        snapshotPaths.push(`${params.modelPathBase}:modified`)
      }
      disposeUnattachedMonacoModelPaths(monaco, snapshotPaths)
    }, 0)
  }, [params.modelPathBase, params.modifiedModelPath])
  const disposeDiffModelsRef = useRef(disposeDiffModels)
  // Keep callback-ref dispose path on the latest disposer without render-time mutation.
  useEffect(() => {
    if (!params.modifiedModelPath) {
      return
    }
    disposeUnattachedMonacoModelPaths(monaco, [`${params.modelPathBase}:modified`])
  }, [params.modelPathBase, params.modifiedModelPath])
  useEffect(() => {
    disposeDiffModelsRef.current = disposeDiffModels
  }, [disposeDiffModels])

  const setSectionRootNode = useCallback((node: HTMLDivElement | null): void => {
    if (node) {
      return
    }
    disposeDiffModelsRef.current()
  }, [])

  useEffect(() => {
    if (params.collapsed) {
      disposeDiffModels()
    }
  }, [disposeDiffModels, params.collapsed])

  return { disposeDiffModels, setSectionRootNode }
}
