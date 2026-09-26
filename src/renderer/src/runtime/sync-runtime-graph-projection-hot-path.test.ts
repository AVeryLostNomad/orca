import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '../store/types'
import type { WorkingDocument, WorkingDocumentId } from '../store/slices/editor/working-document'
import { makeAgentStatusEntry, makeState } from './sync-runtime-graph-test-harness'
import type * as EditorDraftHashModule from './sync-runtime-graph/editor-draft-hash'

// Why the mock: content hashing is the only per-keystroke cost that scales with file size, so the
// regression this file guards is "how many characters were hashed", not "how long did it take".
// Instrumenting the real function through its own module keeps the counter out of shipped code.
const contentHashCounter = vi.hoisted(() => ({ calls: 0, chars: 0 }))
vi.mock('./sync-runtime-graph/editor-draft-hash', async (importOriginal) => {
  // The hoisted mock must load the unmocked implementation through its factory.
  const actual = await importOriginal<typeof EditorDraftHashModule>()
  return {
    stableHashString: (value: string): string => {
      contentHashCounter.calls += 1
      contentHashCounter.chars += value.length
      return actual.stableHashString(value)
    }
  }
})

import { stableHashString } from './sync-runtime-graph/editor-draft-hash'
import {
  buildRuntimeMobileAgentStatusProjectionForTests,
  getRuntimeMobileSessionSyncKey,
  resetRuntimeMobileAgentStatusProjectionCacheForTests,
  resetRuntimeMobileSyncProjectionCachesForTests,
  runtimeMobileSessionSyncKeysEqual
} from './sync-runtime-graph'
import {
  buildRuntimeMobileBrowserProjection,
  buildRuntimeMobileOpenFilesProjection,
  buildRuntimeMobileWorkingDocumentsProjection
} from './sync-runtime-graph/sync-projections'
import { AGENT_STATUS_SYNC_UPDATED_AT_BUCKET_MS } from './sync-runtime-graph/graph-state'

// ── Reference implementations: the pre-change bodies, kept verbatim ────────────────────

function referenceWorkingDocumentsProjection(
  state: Pick<AppState, 'workingDocuments' | 'workingDocumentIdsByTab'>
): string {
  return JSON.stringify({
    documents: Object.fromEntries(
      Object.values(state.workingDocuments).map((document) => [
        document.id,
        {
          revision: document.revision,
          content: document.content === undefined ? undefined : stableHashString(document.content),
          isDirty: document.isDirty
        }
      ])
    ),
    memberships: state.workingDocumentIdsByTab
  })
}

function referenceOpenFilesProjection(openFiles: AppState['openFiles']): string {
  return JSON.stringify(
    openFiles.map((file) => ({
      id: file.id,
      filePath: file.filePath,
      relativePath: file.relativePath,
      worktreeId: file.worktreeId,
      language: file.language,
      mode: file.mode,
      diffSource: file.diffSource,
      isDirty: file.isDirty,
      isUntitled: file.isUntitled,
      deleteUntouchedOnClose: file.deleteUntouchedOnClose,
      markdownPreviewSourceFileId: file.markdownPreviewSourceFileId
    }))
  )
}

function referenceBrowserProjection(state: AppState): string {
  return JSON.stringify({
    workspacesByWorktree: Object.fromEntries(
      Object.entries(state.browserTabsByWorktree ?? {}).map(([worktreeId, workspaces]) => [
        worktreeId,
        workspaces.map((workspace) => ({
          id: workspace.id,
          activePageId: workspace.activePageId,
          title: workspace.title,
          url: workspace.url,
          loading: workspace.loading,
          canGoBack: workspace.canGoBack,
          canGoForward: workspace.canGoForward
        }))
      ])
    ),
    pagesByWorkspace: Object.fromEntries(
      Object.entries(state.browserPagesByWorkspace ?? {}).map(([workspaceId, pages]) => [
        workspaceId,
        pages.map((page) => ({
          id: page.id,
          title: page.title,
          url: page.url,
          loading: page.loading,
          canGoBack: page.canGoBack,
          canGoForward: page.canGoForward
        }))
      ])
    )
  })
}

/** The pre-change agent-status serialization, including its `localeCompare` sort. */
function referenceAgentStatusProjection(map: AppState['agentStatusByPaneKey']): string {
  return JSON.stringify(
    Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([paneKey, entry]) => ({
        paneKey,
        entryPaneKey: entry.paneKey,
        state: entry.state,
        workingMode: entry.workingMode ?? null,
        prompt: entry.prompt,
        updatedAtBucket: Math.floor(entry.updatedAt / AGENT_STATUS_SYNC_UPDATED_AT_BUCKET_MS),
        stateStartedAt: entry.stateStartedAt,
        agentType: entry.agentType ?? null,
        terminalTitle: entry.terminalTitle ?? null,
        stateHistory: entry.stateHistory.map((history) => ({
          state: history.state,
          prompt: history.prompt,
          startedAt: history.startedAt,
          interrupted: history.interrupted ?? null
        })),
        toolName: entry.toolName ?? null,
        toolInput: entry.toolInput ?? null,
        interactivePrompt: entry.interactivePrompt ?? null,
        lastAssistantMessage: entry.lastAssistantMessage ?? null,
        lastAssistantMessageIsToolOutput: entry.lastAssistantMessageIsToolOutput ?? null,
        interrupted: entry.interrupted ?? null
      }))
  )
}

/** Same entries, code-unit ordered — proves the new sort changes order only, never content. */
function sortedProjectionEntries(projection: string): unknown[] {
  return (JSON.parse(projection) as unknown[]).slice().sort((a, b) => {
    const left = JSON.stringify(a)
    const right = JSON.stringify(b)
    return left < right ? -1 : left > right ? 1 : 0
  })
}

// ── Fixtures ──────────────────────────────────────────────────────────────────────────

const WORKING_DOCUMENT_COUNT = 5
const WORKING_DOCUMENT_CHARS = 40_000

function makeWorkingDocuments(contents: Record<string, string>): AppState['workingDocuments'] {
  const documents: Record<WorkingDocumentId, WorkingDocument> = {}
  for (const [fileId, content] of Object.entries(contents)) {
    const id = `working-document:${fileId}` as WorkingDocumentId
    documents[id] = {
      id,
      target: {
        owner: { executionHostId: 'local' as never, runtimeEnvironmentId: null },
        filePath: `/repo/${fileId}`,
        worktreeId: 'wt-1',
        relativePath: fileId,
        language: 'typescript',
        operationProvenance: {} as WorkingDocument['target']['operationProvenance']
      },
      content,
      revision: 1,
      isDirty: true,
      loadState: 'ready',
      writable: true,
      alwaysAutoSave: false
    }
  }
  return documents
}

function makeWorkingDocumentState(
  contents: Record<string, string>
): Pick<AppState, 'workingDocuments' | 'workingDocumentIdsByTab'> {
  const workingDocuments = makeWorkingDocuments(contents)
  const workingDocumentIdsByTab: AppState['workingDocumentIdsByTab'] = {}
  for (const fileId of Object.keys(contents)) {
    workingDocumentIdsByTab[fileId] = [`working-document:${fileId}` as WorkingDocumentId]
  }
  return { workingDocuments, workingDocumentIdsByTab }
}

function makeOpenFile(index: number, overrides: Record<string, unknown> = {}): never {
  return {
    id: `file-${index}`,
    filePath: `/repo/src/file-${index}.ts`,
    relativePath: `src/file-${index}.ts`,
    worktreeId: 'wt-1',
    language: 'typescript',
    mode: 'edit',
    isDirty: false,
    isUntitled: false,
    ...overrides
  } as never
}

function makeBrowserWorkspace(index: number, overrides: Record<string, unknown> = {}): never {
  return {
    id: `ws-${index}`,
    activePageId: `page-${index}`,
    title: `tab ${index}`,
    url: `https://example.test/${index}`,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    ...overrides
  } as never
}

function makeBrowserPage(index: number, overrides: Record<string, unknown> = {}): never {
  return {
    id: `page-${index}`,
    title: `page ${index}`,
    url: `https://example.test/${index}`,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    ...overrides
  } as never
}

/**
 * Characters handed back by `JSON.stringify`, which is the allocation these projections dominate.
 * Counting bytes rather than calls keeps the comparison fair: the old code made one big call per
 * rebuild, the new code makes one small call per changed entry.
 */
function countSerializedChars(run: () => void): number {
  const original = JSON.stringify
  let chars = 0
  const spy = vi.spyOn(JSON, 'stringify').mockImplementation(((...args: never[]) => {
    const serialized = (original as (...a: never[]) => string)(...args)
    chars += serialized?.length ?? 0
    return serialized
  }) as typeof JSON.stringify)
  try {
    run()
    return chars
  } finally {
    spy.mockRestore()
  }
}

beforeEach(() => {
  contentHashCounter.calls = 0
  contentHashCounter.chars = 0
  resetRuntimeMobileSyncProjectionCachesForTests()
  resetRuntimeMobileAgentStatusProjectionCacheForTests()
})

describe('working-document projection on the typing path', () => {
  it('hashes only the changed canonical document per keystroke', () => {
    const typedCharacters = 100
    const totalDocumentChars = WORKING_DOCUMENT_COUNT * WORKING_DOCUMENT_CHARS
    const initialContent = Object.fromEntries(
      Array.from({ length: WORKING_DOCUMENT_COUNT }, (_value, index) => [
        `file-${index}`,
        'x'.repeat(WORKING_DOCUMENT_CHARS)
      ])
    ) as Record<string, string>
    const changedDocumentId = 'working-document:file-0' as WorkingDocumentId

    let uncachedState = makeWorkingDocumentState(initialContent)
    referenceWorkingDocumentsProjection(uncachedState)
    contentHashCounter.calls = 0
    contentHashCounter.chars = 0
    for (let keystroke = 0; keystroke < typedCharacters; keystroke += 1) {
      const document = uncachedState.workingDocuments[changedDocumentId]!
      uncachedState = {
        ...uncachedState,
        workingDocuments: {
          ...uncachedState.workingDocuments,
          [changedDocumentId]: {
            ...document,
            content: `${document.content}a`,
            revision: document.revision + 1
          }
        }
      }
      referenceWorkingDocumentsProjection(uncachedState)
    }
    const before = { calls: contentHashCounter.calls, chars: contentHashCounter.chars }

    resetRuntimeMobileSyncProjectionCachesForTests()
    let memoizedState = makeWorkingDocumentState(initialContent)
    buildRuntimeMobileWorkingDocumentsProjection(memoizedState)
    contentHashCounter.calls = 0
    contentHashCounter.chars = 0
    for (let keystroke = 0; keystroke < typedCharacters; keystroke += 1) {
      const document = memoizedState.workingDocuments[changedDocumentId]!
      memoizedState = {
        ...memoizedState,
        workingDocuments: {
          ...memoizedState.workingDocuments,
          [changedDocumentId]: {
            ...document,
            content: `${document.content}a`,
            revision: document.revision + 1
          }
        }
      }
      buildRuntimeMobileWorkingDocumentsProjection(memoizedState)
    }
    const after = { calls: contentHashCounter.calls, chars: contentHashCounter.chars }

    const growth = (typedCharacters * (typedCharacters + 1)) / 2
    expect(before).toEqual({
      calls: typedCharacters * WORKING_DOCUMENT_COUNT,
      chars: typedCharacters * totalDocumentChars + growth
    })
    expect(after).toEqual({
      calls: typedCharacters,
      chars: typedCharacters * WORKING_DOCUMENT_CHARS + growth
    })
    expect(before.chars / after.chars).toBeGreaterThan(WORKING_DOCUMENT_COUNT - 0.1)
  })

  it('matches the uncached projection byte for byte across document shapes', () => {
    const shapes: Record<string, string>[] = [
      {},
      { 'file-a': '' },
      { 'file-a': 'hello' },
      { 'file-a': 'hello', 'file-b': 'world' },
      { 'file-b': 'world', 'file-a': 'hello' },
      { '2': 'numeric-like key', 'file-a': 'hello', '1': 'other' },
      { 'quote"and\\slash': 'body with "quotes" and \\ and \u{1f389}' },
      { 'file-a': 'hello', 'file-b': 'world', 'file-c': 'third' },
      { 'file-a': 'HELLO', 'file-c': 'third' }
    ]
    for (const [index, shape] of shapes.entries()) {
      const state = makeWorkingDocumentState(shape)
      expect({
        index,
        projection: buildRuntimeMobileWorkingDocumentsProjection(state as AppState)
      }).toEqual({
        index,
        projection: referenceWorkingDocumentsProjection(state)
      })
    }
  })

  it('invalidates the internal key when a document moves to a unified tab view state', () => {
    const state = makeWorkingDocumentState({ 'file-a': 'content' })
    const projection = buildRuntimeMobileWorkingDocumentsProjection(state)
    const moved = {
      ...state,
      workingDocumentIdsByTab: {
        'unified-view-state': ['working-document:file-a' as WorkingDocumentId]
      }
    }

    expect(buildRuntimeMobileWorkingDocumentsProjection(moved)).not.toBe(projection)
  })
})

describe('agent-status projection sort', () => {
  it('constructs no ICU collator, and keeps the same entries as the localeCompare order', () => {
    // MAX_LIVE_AGENT_STATUSES — the cap a busy session actually reaches. Real pane keys are
    // `<uuid tab id>:<uuid leaf id>`, so model them as unordered hex rather than a sorted
    // `tab-<n>` run that would let TimSort skip most comparisons.
    let seed = 0x2f6e2b1
    const nextHex = (): string => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed.toString(16).padStart(8, '0')
    }
    const paneKeys = Array.from({ length: 500 }, () => `${nextHex()}-${nextHex()}:${nextHex()}`)
    const map: AppState['agentStatusByPaneKey'] = {}
    for (const [index, paneKey] of paneKeys.entries()) {
      map[paneKey] = makeAgentStatusEntry({ paneKey, prompt: `prompt ${index}` })
    }
    // One ping replaces one entry and re-spreads the map, so the sort runs in full again.
    const pinged = { ...map, [paneKeys[0]]: makeAgentStatusEntry({ paneKey: paneKeys[0] }) }

    const localeCompareSpy = vi.spyOn(String.prototype, 'localeCompare')
    let projection = ''
    let beforeCalls = 0
    let afterCalls = 0
    try {
      referenceAgentStatusProjection(map)
      beforeCalls = localeCompareSpy.mock.calls.length
      localeCompareSpy.mockClear()
      resetRuntimeMobileAgentStatusProjectionCacheForTests()
      projection = buildRuntimeMobileAgentStatusProjectionForTests(map)
      buildRuntimeMobileAgentStatusProjectionForTests(pinged)
      afterCalls = localeCompareSpy.mock.calls.length
    } finally {
      // `mockRestore` clears the recorded calls, so read the counts first.
      localeCompareSpy.mockRestore()
    }
    // Before: thousands of ICU collator comparisons for a single ping.
    expect(beforeCalls).toBeGreaterThan(3000)
    expect(afterCalls).toBe(0)

    // The projection is identical up to ordering, and ordering is only ever `===`-compared.
    expect(sortedProjectionEntries(projection)).toEqual(
      sortedProjectionEntries(referenceAgentStatusProjection(map))
    )
  })

  it('is deterministic for keys where locale and code-unit order disagree', () => {
    const map: AppState['agentStatusByPaneKey'] = {}
    for (const paneKey of ['b:leaf', 'A:leaf', 'a:leaf', 'á:leaf', 'B:leaf']) {
      map[paneKey] = makeAgentStatusEntry({ paneKey })
    }
    resetRuntimeMobileAgentStatusProjectionCacheForTests()
    const first = buildRuntimeMobileAgentStatusProjectionForTests(map)
    resetRuntimeMobileAgentStatusProjectionCacheForTests()
    const second = buildRuntimeMobileAgentStatusProjectionForTests({ ...map })
    expect(second).toBe(first)
    expect(sortedProjectionEntries(first)).toEqual(
      sortedProjectionEntries(referenceAgentStatusProjection(map))
    )
  })
})

describe('open-files and browser projections', () => {
  it('re-serializes only the changed entry per store write', () => {
    const files = Array.from({ length: 20 }, (_value, index) => makeOpenFile(index))
    const writes = 50
    const driveWrites = (project: (openFiles: AppState['openFiles']) => string): void => {
      let openFiles = files as unknown as AppState['openFiles']
      project(openFiles)
      for (let write = 0; write < writes; write += 1) {
        const next = [...openFiles]
        next[0] = makeOpenFile(0, { isDirty: write % 2 === 0 })
        openFiles = next as unknown as AppState['openFiles']
        project(openFiles)
      }
    }

    const before = countSerializedChars(() => {
      driveWrites(referenceOpenFilesProjection)
    })
    resetRuntimeMobileSyncProjectionCachesForTests()
    const after = countSerializedChars(() => {
      driveWrites(buildRuntimeMobileOpenFilesProjection)
    })
    // Only the flipped file re-serializes; the other 19 are reused by identity.
    expect(before / after).toBeGreaterThan(14)
  })

  it('re-serializes only the changed browser bucket per store write', () => {
    const workspaces = Array.from({ length: 8 }, (_value, index) => makeBrowserWorkspace(index))
    const pagesByWorkspace: Record<string, never[]> = {}
    for (let index = 0; index < 8; index += 1) {
      pagesByWorkspace[`ws-${index}`] = [makeBrowserPage(index)] as never[]
    }
    const initial = makeState({
      browserTabsByWorktree: { 'wt-1': workspaces, 'wt-2': workspaces } as never,
      browserPagesByWorkspace: pagesByWorkspace as never
    })
    const writes = 50
    const driveWrites = (project: (state: AppState) => string): void => {
      let state = initial
      project(state)
      for (let write = 0; write < writes; write += 1) {
        const nextWorkspaces = [...(state.browserTabsByWorktree['wt-1'] ?? [])]
        nextWorkspaces[0] = makeBrowserWorkspace(0, { title: `tab 0 (${write})` })
        state = makeState({
          ...state,
          browserTabsByWorktree: {
            ...state.browserTabsByWorktree,
            'wt-1': nextWorkspaces
          } as never
        })
        project(state)
      }
    }

    const before = countSerializedChars(() => {
      driveWrites(referenceBrowserProjection)
    })
    resetRuntimeMobileSyncProjectionCachesForTests()
    const after = countSerializedChars(() => {
      driveWrites(buildRuntimeMobileBrowserProjection)
    })
    // Only the 'wt-1' bucket re-serializes; 'wt-2' and every page bucket are reused.
    expect(before / after).toBeGreaterThan(2.5)
  })

  it('matches the uncached projections byte for byte across shapes', () => {
    const openFileShapes: AppState['openFiles'][] = [
      [] as unknown as AppState['openFiles'],
      [makeOpenFile(0)] as unknown as AppState['openFiles'],
      [makeOpenFile(0, { isDirty: true })] as unknown as AppState['openFiles'],
      [
        makeOpenFile(0, { isDirty: true, diffSource: 'working' }),
        makeOpenFile(1, { mode: 'diff', markdownPreviewSourceFileId: 'file-0' }),
        makeOpenFile(2, { isUntitled: true, deleteUntouchedOnClose: true, language: undefined })
      ] as unknown as AppState['openFiles']
    ]
    for (const [index, shape] of openFileShapes.entries()) {
      expect({ index, projection: buildRuntimeMobileOpenFilesProjection(shape) }).toEqual({
        index,
        projection: referenceOpenFilesProjection(shape)
      })
    }

    const browserShapes: AppState[] = [
      makeState({}),
      makeState({ browserTabsByWorktree: { 'wt-1': [makeBrowserWorkspace(0)] } as never }),
      makeState({
        browserTabsByWorktree: {
          'wt-1': [makeBrowserWorkspace(0, { title: undefined, loading: true })],
          '3': [makeBrowserWorkspace(1)]
        } as never,
        browserPagesByWorkspace: {
          'ws-0': [makeBrowserPage(0), makeBrowserPage(1, { canGoBack: true })],
          'ws-1': []
        } as never
      }),
      makeState({
        browserTabsByWorktree: {} as never,
        browserPagesByWorkspace: { 'ws-9': [makeBrowserPage(9, { url: 'a"b\\c' })] } as never
      })
    ]
    for (const [index, shape] of browserShapes.entries()) {
      expect({ index, projection: buildRuntimeMobileBrowserProjection(shape) }).toEqual({
        index,
        projection: referenceBrowserProjection(shape)
      })
    }
  })
})

describe('sync key transitions', () => {
  it('fires on exactly the transitions the uncached projections would have fired on', () => {
    const documents = { 'file-0': 'aaa', 'file-1': 'bbb' }
    const files = [makeOpenFile(0), makeOpenFile(1)] as unknown as AppState['openFiles']
    const workspaces = [makeBrowserWorkspace(0)] as never
    const status = {
      'tab-0:leaf-0': makeAgentStatusEntry({ paneKey: 'tab-0:leaf-0' })
    } as AppState['agentStatusByPaneKey']

    const base = makeState({
      ...makeWorkingDocumentState(documents),
      openFiles: files,
      browserTabsByWorktree: { 'wt-1': workspaces } as never,
      browserPagesByWorkspace: { 'ws-0': [makeBrowserPage(0)] } as never,
      agentStatusByPaneKey: status
    })

    const documentId = 'working-document:file-0' as WorkingDocumentId
    const updateDocumentContent = (
      from: AppState,
      content: string,
      advanceRevision: boolean
    ): AppState => {
      const document = from.workingDocuments[documentId]!
      return makeState({
        ...from,
        workingDocuments: {
          ...from.workingDocuments,
          [documentId]: {
            ...document,
            content,
            revision: advanceRevision ? document.revision + 1 : document.revision
          }
        }
      })
    }

    // Each step returns the next state; the flag is whether a mobile-visible input really moved.
    const steps: { name: string; next: (from: AppState) => AppState }[] = [
      { name: 'no-op re-spread', next: (from) => makeState({ ...from }) },
      {
        name: 'keystroke in one document',
        next: (from) => updateDocumentContent(from, 'aaab', true)
      },
      {
        name: 'document re-spread with the same content',
        next: (from) => updateDocumentContent(from, 'aaab', false)
      },
      {
        name: 'document removed',
        next: (from) => {
          const { [documentId]: _removed, ...workingDocuments } = from.workingDocuments
          const { 'file-0': _membership, ...workingDocumentIdsByTab } = from.workingDocumentIdsByTab
          return makeState({ ...from, workingDocuments, workingDocumentIdsByTab })
        }
      },
      {
        name: 'isDirty flip',
        next: (from) =>
          makeState({
            ...from,
            openFiles: [makeOpenFile(0, { isDirty: true }), from.openFiles[1]] as never
          })
      },
      {
        name: 'open-files re-spread with identical content',
        next: (from) => makeState({ ...from, openFiles: [...from.openFiles] as never })
      },
      {
        name: 'browser title tick',
        next: (from) =>
          makeState({
            ...from,
            browserTabsByWorktree: {
              'wt-1': [makeBrowserWorkspace(0, { title: 'new title' })]
            } as never
          })
      },
      {
        name: 'browser page loading flip',
        next: (from) =>
          makeState({
            ...from,
            browserPagesByWorkspace: {
              'ws-0': [makeBrowserPage(0, { loading: true })]
            } as never
          })
      },
      {
        name: 'agent-status ping with an unchanged payload',
        next: (from) =>
          makeState({
            ...from,
            agentStatusByPaneKey: {
              'tab-0:leaf-0': makeAgentStatusEntry({ paneKey: 'tab-0:leaf-0' })
            } as never
          })
      },
      {
        name: 'agent-status prompt change',
        next: (from) =>
          makeState({
            ...from,
            agentStatusByPaneKey: {
              'tab-0:leaf-0': makeAgentStatusEntry({ paneKey: 'tab-0:leaf-0', prompt: 'new' })
            } as never
          })
      },
      {
        name: 'second agent added',
        next: (from) =>
          makeState({
            ...from,
            agentStatusByPaneKey: {
              ...from.agentStatusByPaneKey,
              'tab-1:leaf-0': makeAgentStatusEntry({ paneKey: 'tab-1:leaf-0' })
            } as never
          })
      }
    ]

    const referenceTuple = (state: AppState): string[] => [
      referenceWorkingDocumentsProjection(state),
      referenceOpenFilesProjection(state.openFiles),
      referenceBrowserProjection(state),
      referenceAgentStatusProjection(state.agentStatusByPaneKey ?? {})
    ]

    resetRuntimeMobileSyncProjectionCachesForTests()
    resetRuntimeMobileAgentStatusProjectionCacheForTests()
    let previousState = base
    let previousKey = getRuntimeMobileSessionSyncKey(base, undefined, undefined, false)
    let previousReference = referenceTuple(base)

    for (const step of steps) {
      const state = step.next(previousState)
      const key = getRuntimeMobileSessionSyncKey(state, previousState, previousKey, false)
      const reference = referenceTuple(state)
      const referenceChanged = reference.some((part, index) => part !== previousReference[index])
      const keyChanged = !runtimeMobileSessionSyncKeysEqual(key, previousKey)
      expect({ step: step.name, changed: keyChanged }).toEqual({
        step: step.name,
        changed: referenceChanged
      })
      previousState = state
      previousKey = key
      previousReference = reference
    }
  })
})
