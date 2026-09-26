// @vitest-environment happy-dom
import * as monaco from 'monaco-editor'
import { afterEach, describe, expect, it } from 'vitest'
import { createIdentityLineProjections } from '@/lib/diff-comparison/comparison-policy'
import { computeProjectedMonacoDiff } from '@/lib/diff-comparison/monaco-lines-diff'
import {
  buildGitHunkPeekRows,
  buildGitHunkRevertEdit,
  findGitHunkIndexAtLine
} from './git-gutter-hunks'

const models: monaco.editor.ITextModel[] = []

afterEach(() => {
  for (const model of models.splice(0)) {
    model.dispose()
  }
})

function changesFor(original: string, modified: string) {
  return computeProjectedMonacoDiff({
    original: createIdentityLineProjections(original),
    modified: createIdentityLineProjections(modified),
    maxComputationTimeMs: 1_000
  }).changes
}

function revertEach(original: string, modified: string): string[] {
  return changesFor(original, modified).map((change) => {
    const model = monaco.editor.createModel(modified, 'plaintext')
    models.push(model)
    const edit = buildGitHunkRevertEdit(model, change, original)
    model.applyEdits([edit])
    return model.getValue()
  })
}

describe('Git gutter hunk revert', () => {
  it.each([
    ['replacement in the middle', 'a\nb\nc\n', 'a\nB\nc\n'],
    ['insertion in the middle', 'a\nc\n', 'a\nb\nc\n'],
    ['insertion at the start', 'b\nc\n', 'a\nb\nc\n'],
    ['insertion after the last line without a final newline', 'a\nb', 'a\nb\nc'],
    ['deletion in the middle', 'a\nb\nc\n', 'a\nc\n'],
    ['deletion at the start', 'a\nb\nc\n', 'b\nc\n'],
    ['deletion at the end', 'a\nb\nc\n', 'a\nb\n'],
    ['deletion of the final unterminated line', 'a\nb\nc', 'a\nb'],
    ['emptied file', 'a\nb\n', ''],
    ['new file', '', 'a\nb\n'],
    ['added final newline', 'a\nb', 'a\nb\n'],
    ['removed final newline', 'a\nb\n', 'a\nb']
  ])('restores exactly the baseline for a lone %s', (_name, original, modified) => {
    const results = revertEach(original, modified)
    expect(results).toHaveLength(1)
    expect(results[0]).toBe(original)
  })

  it('reverts only the chosen change when several exist', () => {
    const original = 'one\ntwo\nthree\nfour\nfive\n'
    const modified = 'ONE\ntwo\nthree\nfive\nsix\n'
    const changes = changesFor(original, modified)
    expect(changes.length).toBeGreaterThan(1)
    const model = monaco.editor.createModel(modified, 'plaintext')
    models.push(model)
    model.applyEdits([buildGitHunkRevertEdit(model, changes[0]!, original)])
    expect(model.getValue()).toBe('one\ntwo\nthree\nfive\nsix\n')
  })

  it('keeps CRLF line endings when restoring baseline lines', () => {
    const original = 'a\r\nb\r\nc\r\n'
    const modified = 'a\r\nc\r\n'
    const [change] = changesFor(original, modified)
    const model = monaco.editor.createModel(modified, 'plaintext')
    models.push(model)
    model.applyEdits([buildGitHunkRevertEdit(model, change!, original)])
    expect(model.getValue()).toBe(original)
  })
})

describe('Git gutter hunk lookup and rows', () => {
  it('finds the change drawn on a line, including a deletion marker', () => {
    const original = 'a\nb\nc\nd\ne\n'
    const modified = 'a\nB\nc\ne\n'
    const changes = changesFor(original, modified)
    const model = monaco.editor.createModel(modified, 'plaintext')
    models.push(model)
    expect(findGitHunkIndexAtLine(model, changes, original, 2)).toBe(0)
    expect(findGitHunkIndexAtLine(model, changes, original, 4)).toBe(1)
    expect(findGitHunkIndexAtLine(model, changes, original, 3)).toBeNull()
  })

  it('shows context, removed baseline lines, and added working lines with both line numbers', () => {
    const original = 'a\nb\nc\nd\ne\nf\n'
    const modified = 'a\nb\nc\nD\ne\nf\n'
    const changes = changesFor(original, modified)
    const model = monaco.editor.createModel(modified, 'plaintext')
    models.push(model)
    expect(buildGitHunkPeekRows(model, changes, 0, original)).toEqual([
      { kind: 'context', originalLineNumber: 2, modifiedLineNumber: 2, text: 'b' },
      { kind: 'context', originalLineNumber: 3, modifiedLineNumber: 3, text: 'c' },
      { kind: 'removed', originalLineNumber: 4, modifiedLineNumber: null, text: 'd' },
      { kind: 'added', originalLineNumber: null, modifiedLineNumber: 4, text: 'D' },
      { kind: 'context', originalLineNumber: 5, modifiedLineNumber: 5, text: 'e' },
      { kind: 'context', originalLineNumber: 6, modifiedLineNumber: 6, text: 'f' }
    ])
  })

  it('numbers baseline context lines after an earlier insertion and leaves changed context unnumbered', () => {
    const original = 'a\nb\nc\nd\n'
    const modified = 'new\na\nB\nc\nd\n'
    const changes = changesFor(original, modified)
    expect(changes).toHaveLength(2)
    const model = monaco.editor.createModel(modified, 'plaintext')
    models.push(model)
    expect(buildGitHunkPeekRows(model, changes, 1, original)).toEqual([
      { kind: 'context', originalLineNumber: null, modifiedLineNumber: 1, text: 'new' },
      { kind: 'context', originalLineNumber: 1, modifiedLineNumber: 2, text: 'a' },
      { kind: 'removed', originalLineNumber: 2, modifiedLineNumber: null, text: 'b' },
      { kind: 'added', originalLineNumber: null, modifiedLineNumber: 3, text: 'B' },
      { kind: 'context', originalLineNumber: 3, modifiedLineNumber: 4, text: 'c' },
      { kind: 'context', originalLineNumber: 4, modifiedLineNumber: 5, text: 'd' }
    ])
  })
})
