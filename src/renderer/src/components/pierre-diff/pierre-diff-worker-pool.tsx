import { useLayoutEffect, type ReactNode } from 'react'
import { WorkerPoolContextProvider, useWorkerPool } from '@pierre/diffs/react'
import type { ThemesType } from '@pierre/diffs'
import DiffsHighlightWorker from '@pierre/diffs/worker/worker.js?worker'
import { usePierreSyntaxTheme } from './pierre-diff-theme'

// Why: the pool is shared by every diff, while each FileDiff's `theme` option
// only controls its host CSS. Push the selected syntax pair into the workers.
function PierreDiffWorkerTheme({
  children,
  theme
}: {
  children: ReactNode
  theme: ThemesType
}): React.JSX.Element {
  const workerPool = useWorkerPool()
  useLayoutEffect(() => {
    void workerPool?.setRenderOptions({ theme })
  }, [workerPool, theme])
  return <>{children}</>
}

// Why: below the library default of 8 — highlighting is bursty and the
// renderer shares cores with terminals and Monaco's own workers.
const POOL_SIZE = 4

export function PierreDiffProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const theme = usePierreSyntaxTheme()
  return (
    <WorkerPoolContextProvider
      poolOptions={{ workerFactory: () => new DiffsHighlightWorker(), poolSize: POOL_SIZE }}
      highlighterOptions={{ theme }}
    >
      <PierreDiffWorkerTheme theme={theme}>{children}</PierreDiffWorkerTheme>
    </WorkerPoolContextProvider>
  )
}
