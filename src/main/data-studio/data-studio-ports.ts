import { createServer } from 'node:net'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { getDataStudioPortsFilePath, hashRepoId } from './data-studio-paths'

// Data Studio servers need STABLE ports: the workbench's secret storage (saved
// DB passwords) is encrypted browser storage keyed to the http origin
// (127.0.0.1:<port>), so a new port on every start would orphan every saved
// password. ports.json maps repoIdHash → port; one file (not per-profile) so a
// new allocation can skip ports already assigned to repos that aren't running.

// High, uncommon range to keep collisions with dev servers unlikely.
const PORT_RANGE_START = 41100
const PORT_RANGE_END = 41999

type PortsFile = Record<string, number>

// Single main process; serialize read-modify-write cycles in-process.
let fileLock: Promise<unknown> = Promise.resolve()

function withPortsFileLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = fileLock.then(fn, fn)
  fileLock = next.catch(() => {})
  return next
}

async function readPortsFile(): Promise<PortsFile> {
  try {
    const parsed: unknown = JSON.parse(await readFile(getDataStudioPortsFilePath(), 'utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const entries = Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, number] =>
          Number.isInteger(entry[1]) && (entry[1] as number) > 0 && (entry[1] as number) <= 65535
      )
      return Object.fromEntries(entries)
    }
  } catch {
    // Missing or corrupt — treated as empty; assignments re-pick (worst case:
    // saved passwords need re-entering, connection metadata is unaffected).
  }
  return {}
}

async function writePortsFile(ports: PortsFile): Promise<void> {
  const path = getDataStudioPortsFilePath()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(ports, null, 2)}\n`, 'utf8')
}

function probePortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true))
    })
  })
}

async function pickUnassignedFreePort(assigned: Set<number>): Promise<number> {
  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port += 1) {
    if (assigned.has(port)) {
      continue
    }
    if (await probePortFree(port)) {
      return port
    }
  }
  throw new Error('No free Data Studio port available in the reserved range')
}

/** Resolve the stable port for a repo's Data Studio server, allocating on first use.
 *  A persisted port squatted by a foreign process is re-picked (saved passwords for
 *  that repo are orphaned — logged; connection metadata survives server-side). */
export async function allocateStablePort(repoId: string): Promise<number> {
  return withPortsFileLock(async () => {
    const key = hashRepoId(repoId)
    const ports = await readPortsFile()
    const existing = ports[key]
    if (existing !== undefined && (await probePortFree(existing))) {
      return existing
    }
    const assigned = new Set(Object.values(ports))
    const port = await pickUnassignedFreePort(assigned)
    if (existing !== undefined) {
      console.warn(
        `[data-studio] Stable port ${existing} is in use by another process; ` +
          `re-assigned ${port} — saved database passwords for this project may need re-entering`
      )
    }
    ports[key] = port
    await writePortsFile(ports)
    return port
  })
}

/** Drop a repo's port assignment (repo removal). */
export async function releaseStablePort(repoId: string): Promise<void> {
  return withPortsFileLock(async () => {
    const key = hashRepoId(repoId)
    const ports = await readPortsFile()
    if (!(key in ports)) {
      return
    }
    delete ports[key]
    await writePortsFile(ports)
  })
}
