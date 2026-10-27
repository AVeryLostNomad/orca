import { recordSubprocessSpawn } from './main-thread-churn-probe'

/** Runs a synchronous spawn and records how long it blocked main, including timeouts. */
export function measureSyncSubprocess<T>(
  spawned: { binary: string; args: readonly string[] },
  run: () => T
): T {
  const startedAt = performance.now()
  let timedOut = false
  try {
    return run()
  } catch (error) {
    timedOut = (error as NodeJS.ErrnoException | null)?.code === 'ETIMEDOUT'
    throw error
  } finally {
    recordSubprocessSpawn(spawned.binary, spawned.args, performance.now() - startedAt, {
      sync: true,
      timedOut
    })
  }
}
