import { isMainThread } from 'node:worker_threads'
import type { ProcessResult } from '@orca/process-host/process-spec'
import {
  sharedWorkerThreadChildProcessHost,
  type WorkerThreadChildProcess
} from './worker-thread-child-process'
import type {
  WorkerThreadChildSpec,
  WorkerThreadRunSpec
} from './worker-thread-child-process-protocol'

// Why: Windows CreateProcessW runs security/code-integrity callbacks inline; EDR hosts were traced blocking 5s per spawn.
function offloadsWindowsMainThreadSpawns(): boolean {
  return process.platform === 'win32' && isMainThread
}

/** Windows main-thread spawns go to the shared worker; null means the caller should spawn inline. */
export function trySpawnOffWindowsMainThread(
  spec: WorkerThreadChildSpec
): WorkerThreadChildProcess | null {
  return offloadsWindowsMainThreadSpawns()
    ? sharedWorkerThreadChildProcessHost().trySpawn(spec)
    : null
}

/** Windows main-thread barrier runs go to the shared worker; null means the caller should run inline. */
export function tryRunProcessOffWindowsMainThread(
  spec: WorkerThreadRunSpec,
  options: { signal?: AbortSignal; onChildTerminated?: () => void }
): Promise<ProcessResult> | null {
  return offloadsWindowsMainThreadSpawns()
    ? sharedWorkerThreadChildProcessHost().run(spec, options)
    : null
}
