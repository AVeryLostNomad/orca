import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GIT_BASH_FAST_GIT_PS1_BLOCK, GIT_BASH_PRE_PROFILE_BLOCK } from './git-bash-startup-blocks'
import { getBashShellReadyRcfileContent } from './local-pty-shell-ready-bash-rcfile'

const bashAvailable = spawnSync('bash', ['-c', 'exit 0']).status === 0
const gitAvailable = spawnSync('git', ['--version']).status === 0

// Stand-in for Git for Windows' default prompt: its prompt helpers, a __git_ps1 that says it ran,
// and PS1/MSYS2_PS1 exactly as Git's git-prompt.sh leaves them.
const FAKE_GIT_DEFAULT_PROMPT = `__git_eread() { :; }
__git_ps1() { local exit=$?; printf 'STOCK[%s]' "$#"; return $exit; }
PS1='\\w\`__git_ps1\`\\n$ '
MSYS2_PS1="$PS1"`

type BashResult = { status: number | null; stdout: string; stderr: string }

function runBash(script: string, cwd?: string): BashResult {
  const result = spawnSync('bash', ['--noprofile', '--norc', '-c', script], {
    encoding: 'utf8',
    cwd
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

function toPosixPath(path: string): string {
  return spawnSync('bash', ['-c', 'cd "$1" && pwd', '_', path], { encoding: 'utf8' }).stdout.trim()
}

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync(
    'git',
    [
      '-c',
      'user.email=t@example.com',
      '-c',
      'user.name=t',
      '-c',
      'init.defaultBranch=main',
      ...args
    ],
    { cwd, encoding: 'utf8' }
  )
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  }
}

describe.skipIf(!bashAvailable)('Git Bash startup blocks', () => {
  let dir: string
  let posixDir: string
  let chcpMarker: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-git-bash-blocks-'))
    posixDir = toPosixPath(dir)
    chcpMarker = `${posixDir}/chcp-ran`
    // A fake chcp.com first on PATH records whether the block invoked it.
    const fakeChcp = join(dir, 'chcp.com')
    writeFileSync(fakeChcp, `#!/bin/sh\necho "$@" > "${chcpMarker}"\n`)
    chmodSync(fakeChcp, 0o755)
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const withOstype = (ostype: string, body: string): string => `PATH="${posixDir}:$PATH"
OSTYPE=${ostype}
${body}`

  describe('macOS / Linux safety', () => {
    it("the whole rcfile parses with this machine's bash (bash 3.2 on macOS)", () => {
      const rcfile = join(dir, 'rcfile')
      writeFileSync(rcfile, getBashShellReadyRcfileContent())
      const result = spawnSync('bash', ['-n', rcfile], { encoding: 'utf8' })
      expect(result.status, result.stderr).toBe(0)
    })

    for (const ostype of ['darwin23', 'linux-gnu']) {
      it(`${ostype}: both blocks are no-ops`, () => {
        const result = runBash(
          withOstype(
            ostype,
            `rm -f "${chcpMarker}"
${FAKE_GIT_DEFAULT_PROMPT}
${GIT_BASH_PRE_PROFILE_BLOCK}
${GIT_BASH_FAST_GIT_PS1_BLOCK}
[ -e "${chcpMarker}" ] && echo "chcp ran"
echo "sysbashrc=[\${CYG_SYS_BASHRC-unset}]"
declare -F __orca_fast_git_ps1 >/dev/null && echo "fast defined"
[ "$PS1" = "$MSYS2_PS1" ] && echo "PS1 untouched"
__git_ps1`
          )
        )
        expect(result.status, result.stderr).toBe(0)
        expect(result.stdout).toBe('sysbashrc=[unset]\nPS1 untouched\nSTOCK[0]')
      })
    }
  })

  describe('MSYS', () => {
    it('runs chcp, and skips the duplicate bash.bashrc pass only when the first pass ran', () => {
      const ran = runBash(
        withOstype(
          'msys',
          `rm -f "${chcpMarker}"; MSYS2_PS1=x\n${GIT_BASH_PRE_PROFILE_BLOCK}\ncat "${chcpMarker}"; echo "[\${CYG_SYS_BASHRC-unset}]"`
        )
      )
      expect(ran.stdout).toBe('65001\n[1]\n')
      const firstPassMissing = runBash(
        withOstype(
          'msys',
          `unset MSYS2_PS1\n${GIT_BASH_PRE_PROFILE_BLOCK}\necho "[\${CYG_SYS_BASHRC-unset}]"`
        )
      )
      expect(firstPassMissing.stdout).toBe('[unset]\n')
    })

    it('a missing chcp.com does not stop startup', () => {
      const result = runBash(
        `PATH=/nonexistent; OSTYPE=msys; set -e\n${GIT_BASH_PRE_PROFILE_BLOCK}\necho ok`
      )
      expect(result.stdout).toBe('ok\n')
    })

    const afterBlock = (prelude: string): BashResult =>
      runBash(
        withOstype(
          'msys',
          `${FAKE_GIT_DEFAULT_PROMPT}\n${prelude}\n${GIT_BASH_FAST_GIT_PS1_BLOCK}\nprintf '%s|' "$PS1"; declare -F __orca_fast_git_ps1 || echo "no fast"`
        )
      )

    it("points Git's default prompt at the fast path without redefining __git_ps1", () => {
      const result = afterBlock('')
      expect(result.stdout).toBe('\\w`__orca_fast_git_ps1`\\n$ |__orca_fast_git_ps1\n')
      const stock = runBash(
        withOstype('msys', `${FAKE_GIT_DEFAULT_PROMPT}\n${GIT_BASH_FAST_GIT_PS1_BLOCK}\n__git_ps1`)
      )
      expect(stock.stdout).toBe('STOCK[0]')
    })

    it('leaves a customized prompt alone', () => {
      expect(afterBlock(`PS1='mine \`__git_ps1\` $ '`).stdout).toBe('mine `__git_ps1` $ |no fast\n')
    })

    it("leaves the prompt alone when Git's prompt helpers are not loaded", () => {
      expect(afterBlock('unset -f __git_eread').stdout).toBe('\\w`__git_ps1`\\n$ |no fast\n')
      expect(afterBlock('unset -f __git_ps1').stdout).toBe('\\w`__git_ps1`\\n$ |no fast\n')
    })

    describe.skipIf(!gitAvailable)('fast path routing (fake stock)', () => {
      let repo: string
      let plain: string

      beforeAll(() => {
        repo = join(dir, 'repo')
        plain = join(dir, 'plain')
        mkdirSync(repo)
        mkdirSync(plain)
        mkdirSync(join(repo, 'sub'))
        git(repo, 'init', '-q')
        git(repo, 'commit', '-q', '--allow-empty', '-m', 'a')
        git(repo, 'checkout', '-q', '-b', 'feature/x')
      })

      const FAST = '__orca_fast_git_ps1'
      const prompt = (cwd: string, call: string, prelude = ''): BashResult =>
        runBash(
          withOstype(
            'msys',
            `${FAKE_GIT_DEFAULT_PROMPT}\n${GIT_BASH_FAST_GIT_PS1_BLOCK}\n${prelude}\n${call}`
          ),
          cwd
        )

      it('answers a plain branch without the stock function, from the root and a subdirectory', () => {
        expect(prompt(repo, FAST).stdout).toBe(' (feature/x)')
        expect(prompt(join(repo, 'sub'), FAST).stdout).toBe(' (feature/x)')
        expect(prompt(repo, `${FAST} "[%s]"`).stdout).toBe('[feature/x]')
      })

      it('prints nothing outside a repository', () => {
        expect(prompt(plain, FAST).stdout).toBe('')
      })

      it('preserves the exit status it was called with', () => {
        expect(prompt(repo, `(exit 7); ${FAST} >/dev/null; echo " $?"`).stdout).toBe(' 7\n')
        expect(prompt(plain, `(exit 3); ${FAST}; echo "$?"`).stdout).toBe('3\n')
        // ...including when it hands off to the stock function.
        expect(prompt(repo, `(exit 5); ${FAST} a b >/dev/null; echo "$?"`).stdout).toBe('5\n')
      })

      it('hands unusual cases to the stock function', () => {
        expect(prompt(repo, `${FAST} "a" "b"`).stdout).toBe('STOCK[2]')
        expect(prompt(repo, FAST, 'GIT_PS1_SHOWDIRTYSTATE=1').stdout).toBe('STOCK[0]')
        expect(prompt(repo, FAST, `GIT_DIR="${toPosixPath(repo)}/.git"`).stdout).toBe('STOCK[0]')
        expect(prompt(join(repo, '.git'), FAST).stdout).toBe('STOCK[0]')
        expect(
          prompt(repo, `git checkout -q --detach; ${FAST}; git checkout -q feature/x`).stdout
        ).toBe('STOCK[0]')
        expect(prompt(repo, `touch .git/MERGE_HEAD; ${FAST}; rm .git/MERGE_HEAD`).stdout).toBe(
          'STOCK[0]'
        )
      })
    })
  })

  // Exact parity with Git for Windows' real __git_ps1, only where it exists.
  const stockPromptScript = '/mingw64/share/git/completion/git-prompt.sh'
  const onGitForWindows =
    bashAvailable &&
    gitAvailable &&
    runBash(
      `case "$OSTYPE" in msys*) [ -f ${stockPromptScript} ] && echo yes;; esac`
    ).stdout.trim() === 'yes'

  describe.skipIf(!onGitForWindows)('parity with Git for Windows __git_ps1', () => {
    let repo: string

    beforeAll(() => {
      repo = join(dir, 'parity')
      mkdirSync(repo)
      git(repo, 'init', '-q')
      git(repo, 'commit', '-q', '--allow-empty', '-m', 'a')
      git(repo, 'commit', '-q', '--allow-empty', '-m', 'b')
      git(repo, 'tag', 'v1')
      git(repo, 'worktree', 'add', '-q', '-b', 'wt', join(dir, 'parity-wt'))
    })

    const compare = (cwd: string, setup = '', teardown = ''): { fast: string; stock: string } => {
      const result = runBash(
        `. ${stockPromptScript}
PS1='\\w\`__git_ps1\`\\n$ '
MSYS2_PS1="$PS1"
${GIT_BASH_FAST_GIT_PS1_BLOCK}
${setup}
printf '%s\\n' "$(__orca_fast_git_ps1)" "$(__git_ps1)"
${teardown}`,
        cwd
      )
      const [fast = '', stock = ''] = result.stdout.split('\n')
      return { fast, stock }
    }

    it('matches on a branch, in a worktree, detached at a tag, and outside a repo', () => {
      for (const [cwd, setup, teardown] of [
        [repo, '', ''],
        [join(dir, 'parity-wt'), '', ''],
        [repo, 'git checkout -q --detach v1', 'git checkout -q main'],
        [dir, '', '']
      ] as const) {
        const { fast, stock } = compare(cwd, setup, teardown)
        expect(fast).toBe(stock)
      }
      // Not vacuous: the fast path is installed and answers the plain-branch case itself.
      expect(compare(repo).fast).toBe(' (main)')
      expect(existsSync(join(dir, 'parity-wt'))).toBe(true)
    })
  })
})
