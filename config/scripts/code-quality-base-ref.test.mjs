import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveCodeQualityBaseRef } from './code-quality-base-ref.mjs'

describe('resolveCodeQualityBaseRef', () => {
  let fixture
  afterEach(() => {
    rmSync(fixture, { recursive: true, force: true })
  })

  function createFork() {
    fixture = mkdtempSync(join(tmpdir(), 'code-quality-base-'))
    const git = (...args) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
        cwd: fixture,
        encoding: 'utf8'
      }).trim()
    const commit = (file) => {
      writeFileSync(join(fixture, file), file)
      git('add', file)
      git('-c', 'commit.gpgsign=false', 'commit', '-qm', file)
      return git('rev-parse', 'HEAD')
    }
    git('init', '-q', '-b', 'stable')
    git('update-ref', 'refs/remotes/origin/main', commit('stale-fork-main.txt'))
    git('update-ref', 'refs/remotes/upstream/main', commit('upstream-main.txt'))
    commit('fork-work.txt')
    return fixture
  }

  it('prefers the main ref the branch forked from most recently over a stale fork mirror', () => {
    expect(resolveCodeQualityBaseRef(createFork(), undefined, '')).toBe('upstream/main')
  })

  it('keeps an explicit base even when another ref is nearer', () => {
    expect(resolveCodeQualityBaseRef(createFork(), 'origin/main', '')).toBe('origin/main')
  })
})
