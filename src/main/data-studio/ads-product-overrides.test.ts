import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/userData') } }))

import { repairAdsProductOverrides } from './ads-product-overrides'

const COMMIT = '9ca6200018fc206d67a47229f991901a8a453781'

describe('repairAdsProductOverrides', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ads-overrides-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function readOverrides(): Record<string, unknown> {
    return JSON.parse(readFileSync(join(root, 'product.overrides.json'), 'utf8'))
  }

  it('adds the product commit to overrides missing it', () => {
    writeFileSync(join(root, 'product.json'), JSON.stringify({ commit: COMMIT }))
    writeFileSync(
      join(root, 'product.overrides.json'),
      JSON.stringify({ version: '1.53.0', vscodeVersion: '1.82.0' })
    )
    repairAdsProductOverrides(root)
    expect(readOverrides()).toEqual({ version: '1.53.0', vscodeVersion: '1.82.0', commit: COMMIT })
  })

  it('mirrors quality when the product declares one', () => {
    writeFileSync(join(root, 'product.json'), JSON.stringify({ commit: COMMIT, quality: 'stable' }))
    writeFileSync(join(root, 'product.overrides.json'), JSON.stringify({ version: '1.53.0' }))
    repairAdsProductOverrides(root)
    expect(readOverrides()).toMatchObject({ commit: COMMIT, quality: 'stable' })
  })

  it('leaves an already-correct file untouched', () => {
    writeFileSync(join(root, 'product.json'), JSON.stringify({ commit: COMMIT }))
    const content = JSON.stringify({ version: '1.53.0', commit: COMMIT })
    writeFileSync(join(root, 'product.overrides.json'), content)
    repairAdsProductOverrides(root)
    expect(readFileSync(join(root, 'product.overrides.json'), 'utf8')).toBe(content)
  })

  it('is a no-op when the tree is absent or unreadable', () => {
    expect(() => repairAdsProductOverrides(join(root, 'missing'))).not.toThrow()
    writeFileSync(join(root, 'product.json'), 'not json')
    writeFileSync(join(root, 'product.overrides.json'), '{}')
    expect(() => repairAdsProductOverrides(root)).not.toThrow()
    expect(readFileSync(join(root, 'product.overrides.json'), 'utf8')).toBe('{}')
  })
})
