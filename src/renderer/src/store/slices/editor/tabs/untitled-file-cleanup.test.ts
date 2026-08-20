import { describe, expect, it } from 'vitest'
import type { OpenFile } from '../types/open-file'
import {
  shouldDeleteScratchFileOnClose,
  shouldDeleteUntouchedUntitledFile
} from './untitled-file-cleanup'

function makeFile(overrides: Partial<OpenFile>): OpenFile {
  return {
    id: '/tmp/scratch.txt',
    filePath: '/tmp/scratch.txt',
    relativePath: 'scratch.txt',
    worktreeId: 'wt-1',
    language: 'plaintext',
    isDirty: false,
    mode: 'edit',
    ...overrides
  }
}

describe('shouldDeleteScratchFileOnClose', () => {
  it('deletes scratch files even when dirty', () => {
    expect(shouldDeleteScratchFileOnClose(makeFile({ isScratch: true, isDirty: true }))).toBe(true)
    expect(shouldDeleteScratchFileOnClose(makeFile({ isScratch: true }))).toBe(true)
  })

  it('never deletes non-scratch files', () => {
    expect(shouldDeleteScratchFileOnClose(makeFile({}))).toBe(false)
    expect(shouldDeleteScratchFileOnClose(undefined)).toBe(false)
  })

  it('ignores non-edit modes', () => {
    expect(
      shouldDeleteScratchFileOnClose(makeFile({ isScratch: true, mode: 'markdown-preview' }))
    ).toBe(false)
  })
})

describe('shouldDeleteUntouchedUntitledFile', () => {
  it('still requires untouched untitled state', () => {
    expect(shouldDeleteUntouchedUntitledFile(makeFile({ isUntitled: true }), false)).toBe(true)
    expect(
      shouldDeleteUntouchedUntitledFile(makeFile({ isUntitled: true, isDirty: true }), false)
    ).toBe(false)
    expect(shouldDeleteUntouchedUntitledFile(makeFile({ isUntitled: true }), true)).toBe(false)
  })
})
