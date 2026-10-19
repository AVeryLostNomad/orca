import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  measureSyncSpawn,
  reportSpawnBlock,
  setSpawnBlockObserver,
  type SpawnBlock
} from './spawn-block-observer'

afterEach(() => {
  setSpawnBlockObserver(null)
})

describe('spawn block observer', () => {
  it('reports a synchronous run and returns its result', () => {
    const blocks: SpawnBlock[] = []
    setSpawnBlockObserver((block) => blocks.push(block))
    expect(measureSyncSpawn('wsl.exe', ['--status'], () => 'ok')).toBe('ok')
    expect(blocks).toMatchObject([
      { command: 'wsl.exe', args: ['--status'], sync: true, timedOut: false }
    ])
  })

  it('flags an ETIMEDOUT failure as a timeout and rethrows it', () => {
    const blocks: SpawnBlock[] = []
    setSpawnBlockObserver((block) => blocks.push(block))
    const timeout = Object.assign(new Error('spawnSync wsl.exe ETIMEDOUT'), { code: 'ETIMEDOUT' })
    expect(() =>
      measureSyncSpawn('wsl.exe', ['--list'], () => {
        throw timeout
      })
    ).toThrow(timeout)
    expect(blocks[0]).toMatchObject({ sync: true, timedOut: true })
  })

  it('never lets a throwing observer fail the spawn', () => {
    setSpawnBlockObserver(
      vi.fn(() => {
        throw new Error('observer broke')
      })
    )
    expect(() =>
      reportSpawnBlock({ command: 'git', args: [], blockMs: 1, sync: false, timedOut: false })
    ).not.toThrow()
    expect(measureSyncSpawn('git', [], () => 1)).toBe(1)
  })
})
