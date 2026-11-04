import type { PaneUsageSnapshot } from '../../shared/pane-usage-types'

const MAX_PANES = 64
// Panes whose agent stopped reporting hours ago no longer describe a live session.
const MAX_AGE_MS = 6 * 60 * 60 * 1000

/** Latest agent-reported usage per terminal pane, bounded and expiring. */
export class PaneUsageStore {
  private readonly snapshots = new Map<string, PaneUsageSnapshot>()
  private readonly contentByPane = new Map<string, string>()

  get(paneKey: string): PaneUsageSnapshot | undefined {
    return this.snapshots.get(paneKey)
  }

  /** Returns whether renderer-visible content changed. */
  record(snapshot: PaneUsageSnapshot): boolean {
    const content = JSON.stringify([snapshot.agent, snapshot.accounts, snapshot.session])
    const changed = this.contentByPane.get(snapshot.paneKey) !== content
    // Re-insert so insertion order is least-recently-updated first for eviction.
    this.snapshots.delete(snapshot.paneKey)
    this.snapshots.set(snapshot.paneKey, snapshot)
    this.contentByPane.set(snapshot.paneKey, content)
    for (const paneKey of this.snapshots.keys()) {
      if (this.snapshots.size <= MAX_PANES) {
        break
      }
      this.delete(paneKey)
    }
    return changed
  }

  list(now = Date.now()): PaneUsageSnapshot[] {
    const result: PaneUsageSnapshot[] = []
    for (const snapshot of this.snapshots.values()) {
      if (now - snapshot.updatedAt > MAX_AGE_MS) {
        this.delete(snapshot.paneKey)
      } else {
        result.push(snapshot)
      }
    }
    return result
  }

  private delete(paneKey: string): void {
    this.snapshots.delete(paneKey)
    this.contentByPane.delete(paneKey)
  }
}
