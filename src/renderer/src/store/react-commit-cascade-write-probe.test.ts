import { beforeEach, describe, expect, it, vi } from 'vitest'
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { withReactCommitCascadeWriteProbe } from './react-commit-cascade-write-probe'
import type { ReactCommitCascadeWriteBoundary } from '@/lib/react-commit-cascade-store-write-samples'

const { probe, noteWrite } = vi.hoisted(() => ({
  probe: { armed: false },
  noteWrite: vi.fn()
}))
vi.mock('@/lib/react-commit-cascade-store-write-samples', () => ({
  reactCommitCascadeWriteProbe: probe,
  noteReactCommitCascadeStoreWrite: (boundary: ReactCommitCascadeWriteBoundary, partial: unknown) =>
    noteWrite(boundary, partial)
}))

type ProbedState = { ticks: number; label?: string }

function createProbedStore(): UseBoundStore<StoreApi<ProbedState>> {
  return create<ProbedState>()(
    withReactCommitCascadeWriteProbe<ProbedState>(() => ({ ticks: 0, label: 'initial' }))
  )
}

beforeEach(() => {
  probe.armed = false
  noteWrite.mockReset()
})

describe('withReactCommitCascadeWriteProbe', () => {
  // Diagnostics wrap every write; throwing would drop app state.
  it('lands the write even when the sampler throws', () => {
    noteWrite.mockImplementation(() => {
      throw new Error('sampler exploded')
    })
    const useProbedStore = createProbedStore()
    probe.armed = true

    expect(() => useProbedStore.setState({ ticks: 3 })).not.toThrow()
    expect(useProbedStore.getState().ticks).toBe(3)
  })

  // create copies api.setState onto the hook after creator runs; require the middleware to cover that path too.
  it('routes the api setState through the probe', () => {
    const useProbedStore = createProbedStore()
    probe.armed = true

    useProbedStore.setState({ ticks: 1 })

    expect(noteWrite).toHaveBeenCalledTimes(1)
    // The boundary must be the wrapper itself, so V8 elides it from the sample.
    expect(noteWrite.mock.calls[0]?.[0]).toBe(useProbedStore.setState)
    expect(noteWrite.mock.calls[0]?.[1]).toEqual({ ticks: 1 })
  })

  it('passes the replace flag through', () => {
    const useProbedStore = createProbedStore()
    probe.armed = true

    useProbedStore.setState({ ticks: 2 }, true)

    expect(useProbedStore.getState()).toEqual({ ticks: 2 })
  })

  it('costs nothing but a flag read while unarmed', () => {
    const useProbedStore = createProbedStore()

    useProbedStore.setState({ ticks: 4 })

    expect(noteWrite).not.toHaveBeenCalled()
    expect(useProbedStore.getState().ticks).toBe(4)
  })
})
