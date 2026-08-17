import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { userDataHolder } = vi.hoisted(() => ({ userDataHolder: { path: '' } }))

vi.mock('electron', () => ({
  app: { getPath: () => userDataHolder.path }
}))

import { allocateStablePort, releaseStablePort } from './data-studio-ports'
import { getDataStudioPortsFilePath, hashRepoId } from './data-studio-paths'

const REPO_A = 'repo-a::/x/a'
const REPO_B = 'repo-b::/x/b'

function readPorts(): Record<string, number> {
  return JSON.parse(readFileSync(getDataStudioPortsFilePath(), 'utf8'))
}

function occupyPort(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

describe('data-studio-ports', () => {
  const openServers: Server[] = []

  beforeEach(() => {
    userDataHolder.path = mkdtempSync(join(tmpdir(), 'orca-ds-ports-'))
  })

  afterEach(async () => {
    await Promise.all(
      openServers
        .splice(0)
        .map((server) => new Promise<void>((resolve) => server.close(() => resolve())))
    )
    rmSync(userDataHolder.path, { recursive: true, force: true })
  })

  it('allocates a port in the reserved range, persists it, and reuses it', async () => {
    const port = await allocateStablePort(REPO_A)
    expect(port).toBeGreaterThanOrEqual(41100)
    expect(port).toBeLessThanOrEqual(41999)
    expect(readPorts()[hashRepoId(REPO_A)]).toBe(port)
    // Stability is the point: secret storage is keyed to the http origin.
    expect(await allocateStablePort(REPO_A)).toBe(port)
  })

  it('never assigns one port to two repos, even when neither server is running', async () => {
    const portA = await allocateStablePort(REPO_A)
    const portB = await allocateStablePort(REPO_B)
    expect(portB).not.toBe(portA)
  })

  it('re-picks and persists a new port when a foreign process squats the saved one', async () => {
    const portA = await allocateStablePort(REPO_A)
    openServers.push(await occupyPort(portA))
    const rePicked = await allocateStablePort(REPO_A)
    expect(rePicked).not.toBe(portA)
    expect(readPorts()[hashRepoId(REPO_A)]).toBe(rePicked)
  })

  it('treats a corrupt ports file as empty instead of throwing', async () => {
    mkdirSync(join(userDataHolder.path, 'data-studio'), { recursive: true })
    writeFileSync(getDataStudioPortsFilePath(), 'not json{{{')
    const port = await allocateStablePort(REPO_A)
    expect(port).toBeGreaterThanOrEqual(41100)
    expect(readPorts()[hashRepoId(REPO_A)]).toBe(port)
  })

  it('releaseStablePort drops the assignment', async () => {
    await allocateStablePort(REPO_A)
    await releaseStablePort(REPO_A)
    expect(readPorts()[hashRepoId(REPO_A)]).toBeUndefined()
  })
})
