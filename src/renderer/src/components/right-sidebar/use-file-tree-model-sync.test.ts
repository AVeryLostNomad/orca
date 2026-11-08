// @vitest-environment happy-dom

import { act, createElement, useEffect, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { FileTree } from '@pierre/trees'
import { afterEach, describe, expect, it, vi } from 'vitest'

const resetCalls = vi.hoisted(() => [] as { model: unknown; paths: string[] }[])

vi.mock('./use-file-tree-expansion-sync', () => ({
  resetFileTreePathsWithExpansion: (model: unknown, paths: string[]) => {
    resetCalls.push({ model, paths })
  }
}))
vi.mock('@/store', () => ({ useAppStore: { getState: () => ({ expandedDirs: {} }) } }))

import { useFileTreeContentReset } from './use-file-tree-model-sync'

let root: Root | null = null
const contentVersion = {}

/** Mirrors useFileExplorerTreeModel: a scope change recreates the model before the reset runs. */
function ScopedTree({ treeRootPath, paths }: { treeRootPath: string; paths: string[] }): null {
  const lastResetSignatureRef = useRef<string | null>(null)
  const [model, setModel] = useState<FileTree | null>(null)
  useEffect(() => {
    lastResetSignatureRef.current = null
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the reset is mocked and only compares identity.
    setModel({ root: treeRootPath } as unknown as FileTree)
  }, [treeRootPath])
  useFileTreeContentReset({
    model,
    activeWorktreeId: 'wt',
    treeRootPath,
    contentVersion,
    buildInputPaths: () => paths,
    lastResetSignatureRef
  })
  return null
}

async function render(props: { treeRootPath: string; paths: string[] }): Promise<void> {
  if (!root) {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  }
  await act(async () => {
    root?.render(createElement(ScopedTree, props))
  })
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  resetCalls.length = 0
})

describe('useFileTreeContentReset', () => {
  it('fills the model recreated for a new scope whose listing is already loaded', async () => {
    await render({ treeRootPath: 'C:/proj/Assets', paths: ['Scripts/'] })
    await render({ treeRootPath: 'C:/proj', paths: ['Assets/', 'Library/', 'Packages/'] })

    const last = resetCalls.at(-1)
    expect(last?.model).toEqual({ root: 'C:/proj' })
    expect(last?.paths).toEqual(['Assets/', 'Library/', 'Packages/'])
  })
})
