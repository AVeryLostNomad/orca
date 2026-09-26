import { describe, expect, it, vi } from 'vitest'
import {
  createComparisonProjection,
  mapProjectedColumnToRaw,
  normalizeComparisonLineEndings
} from './comparison-policy'
import { computeProjectedMonacoDiff } from './monaco-lines-diff'
import { computeComparison } from './comparison-engine'

async function compare(
  originalContent: string,
  modifiedContent: string,
  language: string,
  showWhitespace = false
) {
  const projection = await createComparisonProjection({
    originalContent,
    modifiedContent,
    language,
    showWhitespace
  })
  const result = computeProjectedMonacoDiff({
    original: projection.original,
    modified: projection.modified,
    maxComputationTimeMs: 1000
  })
  return { projection, result }
}

describe('meaning-aware diff comparison policy', () => {
  it('normalizes CRLF only for comparison while retaining final-newline changes', async () => {
    expect(normalizeComparisonLineEndings('one\r\ntwo\r\n')).toBe('one\ntwo\n')
    expect((await compare('', '', 'typescript')).result.changes).toEqual([])
    expect((await compare('one\r\ntwo\r\n', 'one\ntwo\n', 'typescript')).result.changes).toEqual([])
    expect((await compare('one\n', 'one', 'typescript')).result.changes).not.toEqual([])
  })

  it('ignores only safe source-code edge spacing and preserves meaningful token content', async () => {
    const formatting = await compare('  const answer = 1  \n', 'const answer = 1\n', 'typescript')
    expect(formatting.projection.semantic).toBe(true)
    expect(formatting.result.changes).toEqual([])

    const trueChange = await compare('  const answer = 1  \n', 'const answer = 2\n', 'typescript')
    expect(trueChange.result.changes).toHaveLength(1)

    expect(
      (await compare('const label = "a b"  \n', 'const label = "a  b"\n', 'typescript')).result
        .changes
    ).not.toEqual([])
    expect((await compare('// note  \n', '// note\n', 'typescript')).result.changes).not.toEqual([])
  })

  it('refuses JSX and uncertain scopes rather than suppressing their whitespace', async () => {
    const jsx = await compare('  <p>hello world</p>\n', '<p>hello world</p>\n', 'typescript')
    expect(jsx.projection.semantic).toBe(false)
    expect(jsx.result.changes).not.toEqual([])

    const unknown = await compare('  data  \n', 'data\n', 'plaintext')
    expect(unknown.projection.semantic).toBe(false)
    expect(unknown.result.changes).not.toEqual([])

    const timedOut = await createComparisonProjection({
      originalContent: '  const value = 1  \n',
      modifiedContent: 'const value = 1\n',
      language: 'typescript',
      showWhitespace: false,
      budgetMs: 0
    })
    expect(timedOut.semantic).toBe(false)
    expect(timedOut.quitEarly).toBe(true)
    expect(timedOut.original[0]?.projected).toBe('  const value = 1  ')
  })

  it.each([
    ['javascript', '<>\n  hello\n</>\n', '<>\nhello\n</>\n'],
    ['typescript', 'const value = `\n  text\n`\n', 'const value = `\ntext\n`\n'],
    ['typescript', 'const  value = 1\n', 'const value = 1\n'],
    ['typescript', '\u00a0const value = 1\n', 'const value = 1\n'],
    ['typescript', 'const value = 1\n  \n', 'const value = 1\n\n'],
    ['typescript', '  const value = "unterminated\n', 'const value = "unterminated\n']
  ])('preserves meaningful or uncertain %s text: %j', async (language, original, modified) => {
    expect((await compare(original, modified, language)).result.changes).not.toEqual([])
  })

  it('keeps indentation-sensitive and Markdown whitespace literal', async () => {
    expect(
      (await compare('  if ready:\n    run()\n', 'if ready:\n    run()\n', 'python')).result.changes
    ).not.toEqual([])
    expect(
      (await compare('paragraph  \nnext\n', 'paragraph\nnext\n', 'markdown')).result.changes
    ).not.toEqual([])
    expect(
      (
        await compare(
          '  multi = """\n    value\n  """\n',
          'multi = """\n    value\n  """\n',
          'python'
        )
      ).result.changes
    ).not.toEqual([])
  })

  it('only ignores HTML whitespace inside recognized tags', async () => {
    const attributes = await compare(
      '<article\n  data-state=ready\n  aria-label=menu\n>\n',
      '<article\ndata-state=ready\naria-label=menu\n>\n',
      'html'
    )
    expect(attributes.projection.semantic).toBe(true)
    expect(attributes.result.changes).toEqual([])

    expect(
      (await compare('<p>hello world</p>\n', '<p>hello  world</p>\n', 'html')).result.changes
    ).not.toEqual([])
    expect(
      (await compare('<pre>  keep\n</pre>\n', '<pre> keep\n</pre>\n', 'html')).result.changes
    ).not.toEqual([])
    expect(
      (await compare('<textarea>  keep\n</textarea>\n', '<textarea> keep\n</textarea>\n', 'html'))
        .result.changes
    ).not.toEqual([])
    expect(
      (
        await compare(
          '<script>const value = "a b"\n</script>\n',
          '<script>const value = "a  b"\n</script>\n',
          'html'
        )
      ).result.changes
    ).not.toEqual([])
    expect(
      (await compare('<p title="a b"></p>\n', '<p title="a  b"></p>\n', 'html')).result.changes
    ).not.toEqual([])
    expect(
      (await compare('<p data-id=one></p>\n', '<p data-id=two></p>\n', 'html')).result.changes
    ).not.toEqual([])
  })

  it('maps Monaco inner ranges back to raw UTF-16 columns without discarded suffixes', async () => {
    const { projection, result } = await compare(
      '  const emoji = "😀"  \n',
      'const emoji = "😁"\n',
      'typescript'
    )
    expect(
      mapProjectedColumnToRaw(projection.original[0]!, projection.original[0]!.projected.length + 1)
    ).toBe(21)
    const innerRange = result.changes[0]?.innerChanges?.[0]?.originalRange
    expect(innerRange?.[1]).toBe(19)
    expect(innerRange?.[3]).toBe(20)
  })

  it('compares all whitespace literally when explicitly requested', async () => {
    const raw = await compare('  const value = 1  \n', 'const value = 1\n', 'typescript', true)
    expect(raw.projection.semantic).toBe(false)
    expect(raw.result.changes).not.toEqual([])
  })

  it('keeps a proven empty Pierre side distinct from an absent side and restores raw EOF bytes', async () => {
    const presentEmpty = await computeComparison({
      id: 1,
      output: 'pierre',
      originalContent: '',
      modifiedContent: 'created\n',
      oldFile: { name: 'empty.ts', contents: '' },
      newFile: { name: 'empty.ts', contents: 'created\n' },
      language: 'typescript',
      showWhitespace: false,
      originalVersion: 1,
      modifiedVersion: 1
    })
    const absent = await computeComparison({
      id: 2,
      output: 'pierre',
      originalContent: '',
      modifiedContent: 'created\n',
      oldFile: null,
      newFile: { name: 'created.ts', contents: 'created\n' },
      language: 'typescript',
      showWhitespace: false,
      originalVersion: 1,
      modifiedVersion: 1
    })
    const raw = await computeComparison({
      id: 3,
      output: 'pierre',
      originalContent: '  before  \r\nlast',
      modifiedContent: 'after\nlast\n',
      oldFile: { name: 'raw.ts', contents: '  before  \r\nlast' },
      newFile: { name: 'raw.ts', contents: 'after\nlast\n' },
      language: 'typescript',
      showWhitespace: false,
      originalVersion: 1,
      modifiedVersion: 1
    })
    if (presentEmpty.output !== 'pierre' || absent.output !== 'pierre' || raw.output !== 'pierre') {
      throw new Error('Expected Pierre results')
    }
    expect(presentEmpty.fileDiff.type).toBe('change')
    expect(presentEmpty.fileDiff.deletionLines).toEqual([])
    expect(absent.fileDiff.type).toBe('new')
    expect(raw.fileDiff.deletionLines).toEqual(['  before  \r\n', 'last'])
    expect(raw.fileDiff.additionLines).toEqual(['after\n', 'last\n'])
  })

  it('does not classify a present file emptied by an edit as a deleted file', async () => {
    const result = await computeComparison({
      id: 4,
      output: 'pierre',
      originalContent: 'before\n',
      modifiedContent: '',
      oldFile: { name: 'empty.ts', contents: 'before\n' },
      newFile: { name: 'empty.ts', contents: '' },
      language: 'typescript',
      showWhitespace: false,
      originalVersion: 1,
      modifiedVersion: 2
    })
    if (result.output !== 'pierre') {
      throw new Error('Expected Pierre result')
    }
    expect(result.fileDiff.type).toBe('change')
    expect(result.fileDiff.deletionLines).toEqual(['before\n'])
    expect(result.fileDiff.additionLines).toEqual([])
  })

  it('runs the worker protocol with bounded request identity responses', async () => {
    const responses: unknown[] = []
    const request = {
      id: 41,
      output: 'monaco' as const,
      originalContent: '  const value = 1  \n',
      modifiedContent: 'const value = 1\n',
      language: 'typescript',
      showWhitespace: false,
      originalVersion: 1,
      modifiedVersion: 2
    }
    const workerScope: {
      postMessage: (response: unknown) => void
      onmessage?: (event: { data: typeof request }) => void
    } = { postMessage: (response) => responses.push(response) }
    vi.stubGlobal('self', workerScope)
    // The worker reads `self` at module evaluation, so static import cannot
    // install the isolated test scope before its entrypoint executes.
    await import('./comparison-worker')
    if (!workerScope.onmessage) {
      throw new Error('Worker did not install its message handler')
    }
    workerScope.onmessage({ data: request })
    await vi.waitFor(() => expect(responses).toHaveLength(1))
    expect(responses[0]).toMatchObject({
      id: 41,
      output: 'monaco',
      originalVersion: 1,
      modifiedVersion: 2,
      changes: []
    })
    vi.unstubAllGlobals()
  })
})
