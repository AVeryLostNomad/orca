import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPosixBinaryLookup } from './posix-binary-lookup'

const bashAvailable = spawnSync('bash', ['-c', 'exit 0']).status === 0

describe.skipIf(!bashAvailable)('getPosixBinaryLookup', () => {
  let dir: string
  // bash on Windows (Git Bash) wants a POSIX path for PATH entries.
  let posixDir: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-binary-lookup-'))
    const tool = join(dir, 'orcafaketool')
    writeFileSync(tool, '#!/bin/sh\nexit 0\n')
    chmodSync(tool, 0o755)
    posixDir = spawnSync('bash', ['-c', 'cd "$1" && pwd', '_', dir], {
      encoding: 'utf8'
    }).stdout.trim()
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const run = (shell: 'posix' | 'bash', prelude: string, name = 'orcafaketool'): string => {
    const script = `set -eu
PATH="${posixDir}:$PATH"
${prelude}
${getPosixBinaryLookup(name, 'found', shell)}
printf '%s' "$found"`
    const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
    return result.stdout
  }

  for (const shell of ['posix', 'bash'] as const) {
    it(`${shell}: resolves a PATH executable`, () => {
      expect(run(shell, '')).toBe(`${posixDir}/orcafaketool`)
    })

    it(`${shell}: ignores an alias of the same name`, () => {
      expect(run(shell, "shopt -s expand_aliases; alias orcafaketool='echo hi'")).toBe(
        `${posixDir}/orcafaketool`
      )
    })

    it(`${shell}: yields no executable path when a function shadows the name`, () => {
      // The portable form reports the bare name, which callers reject with -x; bash reports nothing.
      const found = run(shell, 'orcafaketool() { :; }')
      expect(found === '' || found === 'orcafaketool').toBe(true)
    })

    it(`${shell}: yields empty for a missing binary without tripping set -e`, () => {
      expect(run(shell, '', 'orca-definitely-missing-binary')).toBe('')
    })
  }
})
