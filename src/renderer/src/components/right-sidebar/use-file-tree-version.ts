import { useEffect, useState } from 'react'
import type { FileTreeModelLike } from './use-file-explorer-tree-model'

/**
 * Re-render signal for @pierre/trees models: bumps a counter (one per frame)
 * on any model event so derived UI (empty states, reveal retries) stays fresh.
 */
export function useFileTreeVersion(model: FileTreeModelLike | null): number {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    if (!model) {
      return
    }
    let frame: number | null = null
    const unsubscribe = model.subscribe(() => {
      if (frame === null) {
        frame = requestAnimationFrame(() => {
          frame = null
          setVersion((current) => current + 1)
        })
      }
    })
    return () => {
      unsubscribe()
      if (frame !== null) {
        cancelAnimationFrame(frame)
      }
    }
  }, [model])
  return version
}
