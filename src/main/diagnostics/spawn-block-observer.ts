/**
 * Seam that lets the main process see how long each spawn held the calling thread.
 *
 * Why: on Windows `uv_spawn` searches PATH and calls CreateProcess synchronously, so
 * a slow PATH entry or an EDR hook freezes Electron main with nothing in the trace to
 * name it. Fed by `recordSubprocessSpawn` (git + the process-host spawn observer).
 */

export type SpawnBlock = {
  command: string
  args: readonly string[]
  blockMs: number
  /** The whole child ran on this thread (spawnSync/execFileSync), not just its start. */
  sync: boolean
  timedOut: boolean
}

let observer: ((block: SpawnBlock) => void) | null = null

export function setSpawnBlockObserver(next: ((block: SpawnBlock) => void) | null): void {
  observer = next
}

export function reportSpawnBlock(block: SpawnBlock): void {
  try {
    observer?.(block)
  } catch {
    // Diagnostics must never turn a successful spawn into a failed one.
  }
}
