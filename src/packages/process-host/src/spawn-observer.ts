// Main installs diagnostics here; daemon, relay, and CLI cannot depend on main code.
/** `sync`: the whole child ran on the calling thread, not just its launch. */
export type SpawnBlockDetails = { sync: boolean; timedOut: boolean }
export type SpawnObserver = (
  command: string,
  args: readonly string[],
  blockMs: number,
  details?: SpawnBlockDetails
) => void

let observer: SpawnObserver | null = null

export function setSpawnObserver(next: SpawnObserver | null): void {
  observer = next
}

export function notifySpawnObserver(
  command: string,
  args: readonly string[],
  blockMs: number,
  details?: SpawnBlockDetails
): void {
  try {
    observer?.(command, args, blockMs, details)
  } catch {
    // Diagnostics must never turn a successful spawn into a failed one.
  }
}

export function hasSpawnObserver(): boolean {
  return observer !== null
}
