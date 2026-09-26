// @vitest-environment happy-dom

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GitBranchChangeEntry } from '../../../../../../shared/git-diff-compare-types'
import { getCombinedDiffFileTreeSectionKey } from '../resolve-changes/combined-diff-section-identity'
import {
  buildCombinedDiffBranchTreeRoots,
  flattenCombinedDiffTreeRoots
} from './combined-diff-file-tree-model'
import { CombinedDiffFileTreeRow } from './combined-diff-file-tree-row'

const entry: GitBranchChangeEntry = { path: 'src/example.ts', status: 'modified' }

function getFileRowNode() {
  const node = flattenCombinedDiffTreeRoots(
    buildCombinedDiffBranchTreeRoots('branch', [entry]),
    new Set()
  ).find((candidate) => candidate.type === 'file')
  if (!node) {
    throw new Error('Expected the fixture file to produce a tree row')
  }
  return node
}

function renderFileRow({
  onNavigate = vi.fn(),
  onOpenWorkingFile = vi.fn(),
  reviewOnly = false
} = {}) {
  render(
    <CombinedDiffFileTreeRow
      node={getFileRowNode()}
      mode="branch"
      worktreePath="/repo"
      activeSectionKey={null}
      sectionIndexByKey={new Map([[getCombinedDiffFileTreeSectionKey('branch', entry), 0]])}
      isCollapsed={false}
      onToggleDirectory={vi.fn()}
      onNavigate={onNavigate}
      onOpenWorkingFile={reviewOnly ? undefined : onOpenWorkingFile}
    />
  )
  const row = document.querySelector<HTMLButtonElement>(
    '[data-combined-diff-tree-path="src/example.ts"]'
  )
  if (!row) {
    throw new Error('Expected the fixture file row')
  }
  return { onNavigate, onOpenWorkingFile, row }
}

afterEach(cleanup)

describe('CombinedDiffFileTreeRow gestures', () => {
  it('scrolls on the initial click, then opens the working file on double-click without a second scroll', () => {
    const { onNavigate, onOpenWorkingFile, row } = renderFileRow()

    fireEvent.click(row, { detail: 1 })
    fireEvent.click(row, { detail: 2 })
    fireEvent.doubleClick(row)

    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(onOpenWorkingFile).toHaveBeenCalledTimes(1)
  })

  it('keeps a review-only tree row from opening a working file on double-click', () => {
    const onNavigate = vi.fn()
    const { row } = renderFileRow({ onNavigate, reviewOnly: true })

    fireEvent.click(row, { detail: 1 })
    fireEvent.click(row, { detail: 2 })
    fireEvent.doubleClick(row)

    expect(onNavigate).toHaveBeenCalledTimes(1)
  })
})
