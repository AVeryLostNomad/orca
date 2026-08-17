import type { ReactNode } from 'react'
import { WorkerPoolContextProvider } from '@pierre/diffs/react'
import DiffsHighlightWorker from '@pierre/diffs/worker/worker.js?worker'

// Why: below the library default of 8 — highlighting is bursty and the
// renderer shares cores with terminals and Monaco's own workers.
const POOL_SIZE = 4

export function PierreDiffProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <WorkerPoolContextProvider
      poolOptions={{ workerFactory: () => new DiffsHighlightWorker(), poolSize: POOL_SIZE }}
      highlighterOptions={{}}
    >
      {children}
    </WorkerPoolContextProvider>
  )
}
