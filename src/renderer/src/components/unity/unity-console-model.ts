import type { UnityConsoleEntry, UnityConsoleLevel } from '../../../../shared/unity-types'

export type UnityConsoleSeverity = 'log' | 'warning' | 'error'

export const UNITY_CONSOLE_SEVERITIES: readonly UnityConsoleSeverity[] = ['log', 'warning', 'error']

export function unityConsoleSeverity(level: UnityConsoleLevel): UnityConsoleSeverity {
  // exception and assert are Unity's error-class entries.
  return level === 'log' || level === 'warning' ? level : 'error'
}

/** A received entry with a session-unique id, stable across retention trimming. */
export type UnityConsoleRecord = UnityConsoleEntry & { id: number }

export type UnityConsoleRow = {
  key: string
  record: UnityConsoleRecord
  /** Occurrences folded into this row (1 when not collapsed). */
  count: number
}

export type UnityConsoleView = {
  rows: UnityConsoleRow[]
  counts: Record<UnityConsoleSeverity, number>
}

export type UnityConsoleFilter = {
  severities: Record<UnityConsoleSeverity, boolean>
  query: string
  collapse: boolean
}

export function appendUnityConsoleRecords(
  existing: readonly UnityConsoleRecord[],
  incoming: readonly UnityConsoleEntry[],
  firstId: number,
  cap: number
): UnityConsoleRecord[] {
  const appended = [
    ...existing,
    ...incoming.map((entry, index) => ({ ...entry, id: firstId + index }))
  ]
  return appended.length > cap ? appended.slice(appended.length - cap) : appended
}

export function firstLine(text: string): string {
  const newline = text.search(/\r?\n/)
  return newline === -1 ? text : text.slice(0, newline)
}

/** Severity counts cover every retained entry; rows honor the severity and text filters. */
export function buildUnityConsoleView(
  records: readonly UnityConsoleRecord[],
  filter: UnityConsoleFilter
): UnityConsoleView {
  const counts: Record<UnityConsoleSeverity, number> = { log: 0, warning: 0, error: 0 }
  const query = filter.query.trim().toLowerCase()
  const rows: UnityConsoleRow[] = []
  const collapsedRows = new Map<string, UnityConsoleRow>()
  for (const record of records) {
    const severity = unityConsoleSeverity(record.level)
    counts[severity] += 1
    if (!filter.severities[severity]) {
      continue
    }
    if (query && !record.message.toLowerCase().includes(query)) {
      continue
    }
    if (!filter.collapse) {
      rows.push({ key: String(record.id), record, count: 1 })
      continue
    }
    const identity = `${record.level}\0${record.message}\0${record.stackTrace}`
    const existing = collapsedRows.get(identity)
    if (existing) {
      existing.count += 1
      // Show the latest occurrence's timestamp while keeping first-seen order.
      existing.record = record
      continue
    }
    const row = { key: `c${record.id}`, record, count: 1 }
    collapsedRows.set(identity, row)
    rows.push(row)
  }
  return { rows, counts }
}
