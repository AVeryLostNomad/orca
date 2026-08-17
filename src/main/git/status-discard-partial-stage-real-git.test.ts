// Real-binary coverage for discarding partially staged files: the mocked-runner
// suite asserts argv only; these prove `git restore --worktree` (index source)
// keeps the staged delta and handles staged-added files.
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bulkDiscardChanges, discardChanges } from './status'

let repo = ''

function git(args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}

beforeEach(async () => {
  repo = await mkdtemp(path.join(tmpdir(), 'orca-discard-partial-stage-'))
  execFileSync('git', ['init', '-q', repo])
  git(['config', 'user.email', 'test@example.com'])
  git(['config', 'user.name', 'Test User'])
  git(['config', 'commit.gpgSign', 'false'])
  await writeFile(path.join(repo, 'file.txt'), 'original')
  git(['add', '-A'])
  git(['commit', '-qm', 'initial'])
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

describe('discardChanges on partially staged files (real git)', () => {
  it('keeps the staged delta and drops only unstaged edits (MM)', async () => {
    await writeFile(path.join(repo, 'file.txt'), 'staged')
    git(['add', 'file.txt'])
    await writeFile(path.join(repo, 'file.txt'), 'staged + unstaged')

    await discardChanges(repo, 'file.txt')

    await expect(readFile(path.join(repo, 'file.txt'), 'utf-8')).resolves.toBe('staged')
    expect(git(['status', '--porcelain'])).toBe('M  file.txt')
  })

  it('restores a staged-added file to its staged content instead of erroring (AM)', async () => {
    await writeFile(path.join(repo, 'added.txt'), 'staged')
    git(['add', 'added.txt'])
    await writeFile(path.join(repo, 'added.txt'), 'staged + unstaged')

    await discardChanges(repo, 'added.txt')

    await expect(readFile(path.join(repo, 'added.txt'), 'utf-8')).resolves.toBe('staged')
    expect(git(['status', '--porcelain'])).toBe('A  added.txt')
  })

  it('bulk discard preserves staged deltas across mixed paths', async () => {
    await writeFile(path.join(repo, 'file.txt'), 'staged')
    git(['add', 'file.txt'])
    await writeFile(path.join(repo, 'file.txt'), 'staged + unstaged')
    await writeFile(path.join(repo, 'plain.txt'), 'untracked')

    await bulkDiscardChanges(repo, ['file.txt', 'plain.txt'])

    await expect(readFile(path.join(repo, 'file.txt'), 'utf-8')).resolves.toBe('staged')
    await expect(readFile(path.join(repo, 'plain.txt'), 'utf-8')).rejects.toThrow()
    expect(git(['status', '--porcelain'])).toBe('M  file.txt')
  })
})
