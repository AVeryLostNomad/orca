import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ReactModule from 'react'

const mocks = vi.hoisted(() => ({
  finishProjectAddWithDefaultCheckout: vi.fn(),
  state: {
    worktreesByRepo: {} as Record<string, never[]>,
    setHideDefaultBranchWorkspace: vi.fn()
  }
}))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactModule>()
  return {
    ...actual,
    useCallback: <T extends (...args: never[]) => unknown>(fn: T) => fn,
    useRef: <T>(value: T) => ({ current: value })
  }
})

vi.mock('@/store', () => ({
  useAppStore: { getState: () => mocks.state }
}))

vi.mock('@/lib/telemetry', () => ({ track: vi.fn() }))

vi.mock('./project-added-default-checkout', () => ({
  finishProjectAddWithDefaultCheckout: mocks.finishProjectAddWithDefaultCheckout
}))

import { useCompleteGitRepoAdd } from './use-complete-git-repo-add'

describe('useCompleteGitRepoAdd', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('closes both hosted dialogs and opens the default checkout after creating a project', async () => {
    const closeModal = vi.fn()
    const closeModalForNavigation = vi.fn()
    const finishProjectAdd = vi.fn()
    const complete = useCompleteGitRepoAdd({
      closeModal,
      closeModalForNavigation,
      finishProjectAdd
    })

    await complete('repo-1', 'create_project')

    expect(finishProjectAdd).not.toHaveBeenCalled()
    expect(mocks.finishProjectAddWithDefaultCheckout).toHaveBeenCalledWith({
      repoId: 'repo-1',
      source: 'create_project',
      executionHostId: undefined,
      closeModal: closeModalForNavigation,
      setHideDefaultBranchWorkspace: mocks.state.setHideDefaultBranchWorkspace
    })
  })

  it('keeps existing-project adds inside the hosted workspace composer', async () => {
    const finishProjectAdd = vi.fn()
    const complete = useCompleteGitRepoAdd({
      closeModal: vi.fn(),
      closeModalForNavigation: vi.fn(),
      finishProjectAdd
    })

    await complete('repo-1', 'clone_url')

    expect(finishProjectAdd).toHaveBeenCalledWith('repo-1', 'clone_url', undefined)
    expect(mocks.finishProjectAddWithDefaultCheckout).not.toHaveBeenCalled()
  })
})
