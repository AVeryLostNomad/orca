import { installRealWorkerThreadChildProcesses } from '../worker-thread-child-process/worker-thread-child-process-real.test-fixtures'
import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../persistence'
import type { Repo } from '../../shared/repo-types'
import type * as OsModule from 'node:os'
import type * as GitRunnerModule from '../git/runner'

const { homeRef, ghExecFileAsyncMock, gitPushMock } = vi.hoisted(() => ({
  homeRef: { current: '' },
  ghExecFileAsyncMock: vi.fn(),
  gitPushMock: vi.fn()
}))

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof OsModule>()
  const homedir = (): string => homeRef.current
  return { ...actual, homedir, default: { ...actual, homedir } }
})
vi.mock('../worktree-root-preparation', () => ({
  prepareLocalWorktreeRootForRepo: vi.fn()
}))
vi.mock('../repo-icon-autodetect', () => ({
  detectRepoIconAndUpstream: vi.fn(async () => ({}))
}))
vi.mock('../github/github-author-identity', () => ({
  resolveGithubAuthorIdentity: vi.fn(async () => null)
}))
vi.mock('../git/remote', () => ({ gitPush: gitPushMock }))
vi.mock('../git/runner', async (importOriginal) => ({
  ...(await importOriginal<typeof GitRunnerModule>()),
  ghExecFileAsync: ghExecFileAsyncMock
}))

import { createPrototype } from './prototype-provisioning'
import { preflightPrototypePromotion, promotePrototype } from './prototype-promotion'
import { deletePrototypeFiles } from './prototype-removal'

// Git runs through the worker-thread child process host.
installRealWorkerThreadChildProcesses()

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`)
  }
  return result.stdout.trim()
}

function createStore(): Store & { repos: Repo[] } {
  const repos: Repo[] = []
  return {
    repos,
    getRepos: () => repos,
    addRepo: (repo: Repo) => repos.push(repo),
    getSettings: () => ({})
  } as unknown as Store & { repos: Repo[] }
}

function unregister(store: Store & { repos: Repo[] }, repoId: string): void {
  store.repos.splice(
    store.repos.findIndex((repo) => repo.id === repoId),
    1
  )
}

async function createRegisteredPrototype(store: Store & { repos: Repo[] }): Promise<Repo> {
  const result = await createPrototype(store)
  if ('error' in result) {
    throw new Error(result.error)
  }
  return result.repo
}

describe('prototype lifecycle (live Git)', () => {
  let root = ''

  beforeAll(() => {
    process.env.GIT_AUTHOR_NAME = 'Test User'
    process.env.GIT_AUTHOR_EMAIL = 'test@example.com'
    process.env.GIT_COMMITTER_NAME = 'Test User'
    process.env.GIT_COMMITTER_EMAIL = 'test@example.com'
  })

  beforeEach(async () => {
    root = realpathSync(await mkdtemp(path.join(tmpdir(), 'orca-prototype-')))
    homeRef.current = path.join(root, 'home')
    await mkdir(homeRef.current)
    ghExecFileAsyncMock.mockReset()
    gitPushMock.mockReset()
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('provisions numbered git repos under the prototypes root', async () => {
    const store = createStore()
    const first = await createRegisteredPrototype(store)
    const second = await createRegisteredPrototype(store)

    const prototypesRoot = path.join(homeRef.current, 'orca', 'prototypes')
    expect(first).toMatchObject({
      path: path.join(prototypesRoot, 'prototype-1'),
      displayName: 'Prototype 1',
      isPrototype: true,
      kind: 'git'
    })
    expect(second.path).toBe(path.join(prototypesRoot, 'prototype-2'))
    expect(git(first.path, ['log', '--format=%s'])).toBe('Initial commit')
  })

  it('rejects promotion targets inside the prototypes root or onto non-empty folders', async () => {
    const store = createStore()
    const prototype = await createRegisteredPrototype(store)

    await expect(
      preflightPrototypePromotion(store, {
        repoId: prototype.id,
        parentPath: path.join(homeRef.current, 'orca', 'prototypes'),
        name: 'escaped'
      })
    ).resolves.toEqual({ error: 'Choose a destination outside the prototypes folder' })

    const occupied = path.join(root, 'projects', 'taken')
    await mkdir(occupied, { recursive: true })
    await writeFile(path.join(occupied, 'file.txt'), 'x')
    await expect(
      preflightPrototypePromotion(store, {
        repoId: prototype.id,
        parentPath: path.join(root, 'projects'),
        name: 'taken'
      })
    ).resolves.toMatchObject({ error: expect.stringContaining('not empty') })
  })

  it('moves the prototype into a regular project and relinks its worktrees', async () => {
    const store = createStore()
    const prototype = await createRegisteredPrototype(store)
    await writeFile(path.join(prototype.path, 'index.ts'), 'export {}\n')
    const linkedPath = path.join(root, 'workspaces', 'feature')
    git(prototype.path, ['worktree', 'add', '--quiet', '-b', 'feature', linkedPath])

    const parentPath = path.join(root, 'projects')
    const preflight = await preflightPrototypePromotion(store, {
      repoId: prototype.id,
      parentPath,
      name: 'my-app'
    })
    expect(preflight).toEqual({
      sourcePath: prototype.path,
      targetPath: path.join(parentPath, 'my-app')
    })
    unregister(store, prototype.id)

    const result = await promotePrototype(store, {
      sourcePath: prototype.path,
      prototypeDisplayName: prototype.displayName,
      parentPath,
      name: 'my-app',
      publishToGithub: false
    })

    const targetPath = path.join(parentPath, 'my-app')
    expect(result).toMatchObject({ repo: { path: targetPath, displayName: 'my-app' } })
    expect('repo' in result && result.repo.isPrototype).toBeFalsy()
    expect(existsSync(prototype.path)).toBe(false)
    expect(existsSync(path.join(targetPath, 'index.ts'))).toBe(true)
    expect(git(linkedPath, ['rev-parse', '--git-common-dir'])).toBe(path.join(targetPath, '.git'))
    expect(ghExecFileAsyncMock).not.toHaveBeenCalled()
  })

  it('creates a GitHub repo and pushes when publishing', async () => {
    const store = createStore()
    const prototype = await createRegisteredPrototype(store)
    unregister(store, prototype.id)
    ghExecFileAsyncMock.mockResolvedValue({
      stdout: 'https://github.com/someone/my-app\n',
      stderr: ''
    })

    const result = await promotePrototype(store, {
      sourcePath: prototype.path,
      prototypeDisplayName: prototype.displayName,
      parentPath: path.join(root, 'projects'),
      name: 'my app',
      publishToGithub: true,
      githubVisibility: 'private'
    })

    const targetPath = path.join(root, 'projects', 'my app')
    expect(ghExecFileAsyncMock).toHaveBeenCalledWith(
      ['repo', 'create', 'my-app', '--private', '--source', targetPath, '--remote', 'origin'],
      expect.objectContaining({ cwd: targetPath, idempotent: false })
    )
    expect(gitPushMock).toHaveBeenCalledWith(targetPath)
    expect(result).toMatchObject({ githubUrl: 'https://github.com/someone/my-app', warnings: [] })
  })

  it('keeps the promoted project and warns when GitHub creation fails', async () => {
    const store = createStore()
    const prototype = await createRegisteredPrototype(store)
    unregister(store, prototype.id)
    ghExecFileAsyncMock.mockRejectedValue(
      Object.assign(new Error('gh failed'), { stderr: 'name already exists on this account' })
    )

    const result = await promotePrototype(store, {
      sourcePath: prototype.path,
      prototypeDisplayName: prototype.displayName,
      parentPath: path.join(root, 'projects'),
      name: 'my-app',
      publishToGithub: true
    })

    expect(result).toMatchObject({
      repo: { displayName: 'my-app' },
      warnings: [expect.stringContaining('name already exists')]
    })
    expect(gitPushMock).not.toHaveBeenCalled()
  })

  it('deletes only unregistered prototype folders, including their worktrees', async () => {
    const store = createStore()
    const prototype = await createRegisteredPrototype(store)
    const linkedPath = path.join(root, 'workspaces', 'feature')
    git(prototype.path, ['worktree', 'add', '--quiet', '-b', 'feature', linkedPath])

    await expect(deletePrototypeFiles(store, prototype.path)).resolves.toEqual({
      error: 'Prototype is still registered'
    })
    const outside = path.join(root, 'outside')
    await mkdir(outside)
    await expect(deletePrototypeFiles(store, outside)).resolves.toEqual({
      error: 'Not a prototype folder'
    })
    await expect(
      deletePrototypeFiles(store, path.join(homeRef.current, 'orca', 'prototypes'))
    ).resolves.toEqual({ error: 'Not a prototype folder' })

    unregister(store, prototype.id)
    await expect(deletePrototypeFiles(store, prototype.path)).resolves.toEqual({ warnings: [] })
    expect(existsSync(prototype.path)).toBe(false)
    expect(existsSync(linkedPath)).toBe(false)
    expect(existsSync(outside)).toBe(true)
  })
})
