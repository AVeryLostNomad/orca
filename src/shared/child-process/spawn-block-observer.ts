/**
 * Seam that lets the main process see how long each spawn held the calling thread.
 *
 * Why: on Windows `uv_spawn` searches PATH and calls CreateProcess synchronously, so
 * a slow PATH entry or an EDR hook freezes Electron main with nothing in the trace to
 * name it. Main installs a reporter at startup; every other host records nothing.
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

/** Times a synchronous child run (execFileSync and friends) and reports it, timeouts included. */
export function measureSyncSpawn<T>(command: string, args: readonly string[], run: () => T): T {
  const startedAt = performance.now()
  let timedOut = false
  try {
    return run()
  } catch (error) {
    timedOut = (error as NodeJS.ErrnoException | null)?.code === 'ETIMEDOUT'
    throw error
  } finally {
    reportSpawnBlock({
      command,
      args,
      blockMs: performance.now() - startedAt,
      sync: true,
      timedOut
    })
  }
}
