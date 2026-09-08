import {
  getProcessOutputFields,
  iterateProcessOutputLines
} from '../../shared/process-output-field-scanner'

/** One row from the host-wide process listing. */
export type ProcRow = {
  pid: number
  ppid: number
  /** Percent of one core (may exceed 100 on multi-core). */
  cpu: number
  /** Resident memory in bytes. */
  memory: number
  /** Committed bytes, resident or paged out. Absent when the host cannot report it. */
  privateMemory?: number
}

/** Indexed view of a single host process sweep. */
export type ProcIndex = {
  byPid: Map<number, ProcRow>
  childrenOf: Map<number, number[]>
  /**
   * Whether this sweep reported committed bytes at all. Data-driven rather than
   * platform-driven: the Windows typeperf fallback can be missing the counter,
   * and reporting a 0 sum then would read as "agents commit nothing".
   */
  hasPrivateMemory: boolean
}

export function parsePsOutput(stdout: string): ProcRow[] {
  const rows: ProcRow[] = []
  for (const line of iterateProcessOutputLines(stdout)) {
    const fields = getProcessOutputFields(line, 4)
    if (fields.length < 4) {
      continue
    }
    const pid = Number.parseInt(fields[0], 10)
    const ppid = Number.parseInt(fields[1], 10)
    const cpu = Number.parseFloat(fields[2])
    const rssKb = Number.parseInt(fields[3], 10)
    if (Number.isNaN(pid) || Number.isNaN(ppid)) {
      continue
    }
    rows.push({
      pid,
      ppid,
      cpu: Number.isFinite(cpu) && cpu > 0 ? cpu : 0,
      memory: Number.isFinite(rssKb) && rssKb > 0 ? rssKb * 1024 : 0
    })
  }
  return rows
}

/** Walk every descendant PID of `root`, inclusive. */
export function collectSubtree(
  index: ProcIndex,
  root: number,
  excludedPids?: ReadonlySet<number>
): number[] {
  const result: number[] = []
  const seen = new Set<number>()
  const queue = [root]
  while (queue.length > 0) {
    const pid = queue.pop()
    if (pid === undefined) {
      break
    }
    // Once a PID was attributed to an earlier PTY, its complete subtree was
    // already traversed. Do not walk those descendants again for overlapping
    // PTY roots (common when several panes share a supervisor).
    if (seen.has(pid) || excludedPids?.has(pid)) {
      continue
    }
    seen.add(pid)
    if (index.byPid.has(pid)) {
      result.push(pid)
    }
    const kids = index.childrenOf.get(pid)
    if (kids) {
      for (const kid of kids) {
        queue.push(kid)
      }
    }
  }
  return result
}
