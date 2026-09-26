import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { runProcess } from '../../../src/shared/child-process/run-process'

export type LiveDiffFixture = {
  name: string
  original: string
  modified: string
  meaningful: boolean
}

export const LIVE_GUTTER_PATH = 'src/editor-live-gutter.ts'
export const LIVE_GUTTER_BASELINE =
  'export const first = 1\nexport const second = 2\nexport const third = 3\nexport const fourth = 4\nexport const fifth = 5\nexport const sixth = 6\nexport const seventh = 7\nexport const eighth = 8\nexport const ninth = 9\nexport const tenth = 10\n'
export const LIVE_GUTTER_CHANGED =
  'export const zero = 0\nexport const first = 1\nexport const second = 20\nexport const third = 3\nexport const fourth = 4\nexport const sixth = 6\nexport const seventh = 7\nexport const eighth = 8\nexport const ninth = 9\nexport const tenth = 10\nexport const eleventh = 11\n'
export const LIVE_GUTTER_HEAD_REFRESH_PATH = 'src/editor-live-gutter-head-refresh.ts'
export const LIVE_GUTTER_HEAD_INITIAL =
  'export const version = 1\nexport const stable = true\nexport const boundary = 0\n'
export const LIVE_GUTTER_HEAD_COMMITTED =
  'export const version = 2\nexport const stable = true\nexport const boundary = 0\n'
export const LIVE_GUTTER_HEAD_WORKTREE =
  'export const version = 4\nexport const stable = true\nexport const boundary = 0\n'

export async function seedLiveDiffGutterFixtures(worktreePath: string): Promise<void> {
  writeFileSync(path.join(worktreePath, LIVE_GUTTER_PATH), LIVE_GUTTER_BASELINE)
  writeFileSync(path.join(worktreePath, LIVE_GUTTER_HEAD_REFRESH_PATH), LIVE_GUTTER_HEAD_INITIAL)
  for (const args of [
    ['add', '--', LIVE_GUTTER_PATH, LIVE_GUTTER_HEAD_REFRESH_PATH],
    [
      '-c',
      'core.hooksPath=',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'Seed editor gutter fixtures'
    ]
  ]) {
    const result = await runProcess({ program: 'git', args, cwd: worktreePath })
    if (result.code !== 0) {
      throw new Error(`Cannot seed editor gutter fixtures: ${result.stderr}`)
    }
  }
}

export const PIERRE_CONTEXT_FIXTURE: LiveDiffFixture = {
  name: 'snapshot-context.ts',
  original: Array.from({ length: 30 }, (_, index) => `export const n${index} = ${index}\n`).join(
    ''
  ),
  modified: Array.from(
    { length: 30 },
    (_, index) => `    export const n${index} = ${index === 15 ? 99 : index}  \n`
  ).join(''),
  meaningful: true
}

export const LIVE_DIFF_WHITESPACE_FIXTURES: readonly LiveDiffFixture[] = [
  PIERRE_CONTEXT_FIXTURE,
  {
    name: 'encoding.ts',
    original: 'const n = 1\n',
    modified: 'const n = 1\r\n',
    meaningful: false
  },
  {
    name: 'code-indent.ts',
    original: 'const n = 1\n',
    modified: '  const n = 1  \n',
    meaningful: false
  },
  {
    name: 'attributes.html',
    original: '<div\n id=main\n class=card\n>text</div>\n',
    modified: '<div\r\n    id=main\r\n    class=card\r\n>text</div>\r\n',
    meaningful: false
  },
  {
    name: 'quoted.html',
    original: '<p title="a b">text</p>\n',
    modified: '<p title="a  b">text</p>\n',
    meaningful: true
  },
  {
    name: 'unquoted.html',
    original: '<p title=a>text</p>\n',
    modified: '<p title=b>text</p>\n',
    meaningful: true
  },
  {
    name: 'text.html',
    original: '<p>hello world</p>\n',
    modified: '<p>hello  world</p>\n',
    meaningful: true
  },
  {
    name: 'text-indent.html',
    original: '<div>\n hello\n</div>\n',
    modified: '<div>\n   hello\n</div>\n',
    meaningful: true
  },
  {
    name: 'pre.html',
    original: '<pre>\n a\n</pre>\n',
    modified: '<pre>\n   a\n</pre>\n',
    meaningful: true
  },
  {
    name: 'textarea.html',
    original: '<textarea>\n a\n</textarea>\n',
    modified: '<textarea>\n   a\n</textarea>\n',
    meaningful: true
  },
  {
    name: 'script.html',
    original: '<script>\n const n = 1\n</script>\n',
    modified: '<script>\n   const n = 1\n</script>\n',
    meaningful: true
  },
  {
    name: 'indent.py',
    original: 'if ready:\n    work()\n',
    modified: 'if ready:\n        work()\n',
    meaningful: true
  },
  {
    name: 'hard-break.md',
    original: 'first\nsecond\n',
    modified: 'first  \nsecond\n',
    meaningful: true
  },
  {
    name: 'template.ts',
    original: 'const value = `\n a\n`\n',
    modified: 'const value = `\n   a\n`\n',
    meaningful: true
  },
  {
    name: 'final-newline.ts',
    original: 'const n = 1\n',
    modified: 'const n = 1',
    meaningful: true
  },
  { name: 'unknown.unknown', original: 'first\n', modified: ' first\n', meaningful: true }
]

export async function seedLiveDiffWhitespaceFixtures(worktreePath: string): Promise<void> {
  for (const fixture of LIVE_DIFF_WHITESPACE_FIXTURES) {
    writeFileSync(path.join(worktreePath, fixture.name), fixture.original)
  }
  for (const args of [
    ['add', '--', ...LIVE_DIFF_WHITESPACE_FIXTURES.map((fixture) => fixture.name)],
    [
      '-c',
      'core.hooksPath=',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'Seed semantic diff fixtures'
    ]
  ]) {
    const result = await runProcess({ program: 'git', args, cwd: worktreePath })
    if (result.code !== 0) {
      throw new Error(`Cannot seed semantic diff fixtures: ${result.stderr}`)
    }
  }
  for (const fixture of LIVE_DIFF_WHITESPACE_FIXTURES) {
    writeFileSync(path.join(worktreePath, fixture.name), fixture.modified)
  }
}
