const SLOW_REMOVAL_STEP_LOG_MS = 500

// Why: pairs with main's per-stage removal logs so a slow delete can be attributed to host work vs renderer teardown.
export async function logSlowRemovalStep<T>(
  worktreeId: string,
  step: string,
  run: () => Promise<T>
): Promise<T> {
  const startedAt = performance.now()
  try {
    return await run()
  } finally {
    const elapsedMs = Math.round(performance.now() - startedAt)
    if (elapsedMs >= SLOW_REMOVAL_STEP_LOG_MS) {
      console.info(`[worktrees] ${step} for ${worktreeId} took ${elapsedMs}ms`)
    }
  }
}
