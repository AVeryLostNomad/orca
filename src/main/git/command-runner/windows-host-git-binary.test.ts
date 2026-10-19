import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { resolveGitCommand } from './git-command-resolution'
import {
  peekWindowsHostGitBinary,
  resetWindowsHostGitBinaryCacheForTests,
  resolveWindowsHostGitBinary
} from './windows-host-git-binary'
import { prepareWindowsHostGitEnvironment } from './windows-host-git-environment'

async function withPlatform<T>(platform: NodeJS.Platform, run: () => T | Promise<T>): Promise<T> {
  const original = process.platform
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
  try {
    return await run()
  } finally {
    Object.defineProperty(process, 'platform', { configurable: true, value: original })
  }
}

describe('windows host git binary', () => {
  let root = ''
  let emptyDir = ''
  let gitDir = ''
  let laterGitDir = ''

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'orca-host-git-'))
    emptyDir = path.join(root, 'empty')
    gitDir = path.join(root, 'git', 'cmd')
    laterGitDir = path.join(root, 'later')
    await mkdir(emptyDir, { recursive: true })
    await mkdir(gitDir, { recursive: true })
    await mkdir(laterGitDir, { recursive: true })
    await writeFile(path.join(gitDir, 'git.exe'), '')
    await writeFile(path.join(laterGitDir, 'git.exe'), '')
    // libuv never spawns a .cmd, so a shim ahead of git.exe must not win.
    await writeFile(path.join(emptyDir, 'git.cmd'), '')
  })

  afterEach(() => {
    resetWindowsHostGitBinaryCacheForTests()
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const expectedBinary = (dir: string): string =>
    path.win32.normalize(`${path.posix.join(dir, 'git')}.exe`)

  it('resolves the first git.exe on PATH, skipping .cmd shims', async () => {
    const env = { Path: [emptyDir, gitDir, laterGitDir].join(';') }
    await expect(resolveWindowsHostGitBinary(env)).resolves.toBe(expectedBinary(gitDir))
    expect(peekWindowsHostGitBinary(env)).toBe(expectedBinary(gitDir))
  })

  it('keys the cache by PATH so a hydrated PATH resolves again', async () => {
    await resolveWindowsHostGitBinary({ PATH: gitDir })
    expect(peekWindowsHostGitBinary({ PATH: laterGitDir })).toBeNull()
    await expect(resolveWindowsHostGitBinary({ PATH: laterGitDir })).resolves.toBe(
      expectedBinary(laterGitDir)
    )
  })

  it('shares one in-flight resolution between concurrent callers', () => {
    const env = { PATH: gitDir }
    expect(resolveWindowsHostGitBinary(env)).toBe(resolveWindowsHostGitBinary(env))
  })

  it('does not cache a miss', async () => {
    await expect(resolveWindowsHostGitBinary({ PATH: emptyDir })).resolves.toBeNull()
    expect(peekWindowsHostGitBinary({ PATH: emptyDir })).toBeNull()
  })

  it('swaps host git for the resolved binary once the environment is prepared', async () => {
    const env = { PATH: gitDir }
    await withPlatform('win32', async () => {
      const options = { cwd: root, env }
      expect(resolveGitCommand(['status'], options).binary).toBe('git')
      await prepareWindowsHostGitEnvironment(resolveGitCommand(['status'], options), env)
      expect(resolveGitCommand(['status'], options).binary).toBe(expectedBinary(gitDir))
    })
  })

  it('leaves non-Windows hosts on bare git', async () => {
    const env = { PATH: gitDir }
    await resolveWindowsHostGitBinary(env)
    await expect(
      withPlatform('linux', () => resolveGitCommand(['status'], { cwd: root, env }).binary)
    ).resolves.toBe('git')
  })
})
