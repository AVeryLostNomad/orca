import { describe, expect, it } from 'vitest'
import {
  formatGithubAccountRef,
  isValidGithubAccountRefString,
  parseGithubAccountRef
} from './github-account-ref'

describe('github account refs', () => {
  it('round-trips gh-cli refs, including ported GHES hosts', () => {
    for (const ref of [
      { kind: 'gh-cli' as const, host: 'github.com', user: 'AVeryLostNomad' },
      { kind: 'gh-cli' as const, host: 'ghe.internal:8443', user: 'joey' }
    ]) {
      expect(parseGithubAccountRef(formatGithubAccountRef(ref))).toEqual(ref)
    }
  })

  it('round-trips pat refs', () => {
    const ref = { kind: 'pat' as const, id: 'abc-123' }
    expect(parseGithubAccountRef(formatGithubAccountRef(ref))).toEqual(ref)
  })

  it('rejects malformed refs', () => {
    for (const raw of ['', 'gh:', 'gh:hostonly', 'gh:host:', 'pat:', 'bogus:x', null, undefined]) {
      expect(parseGithubAccountRef(raw)).toBeNull()
    }
    expect(isValidGithubAccountRefString('gh:github.com:user')).toBe(true)
    expect(isValidGithubAccountRefString('nope')).toBe(false)
    expect(isValidGithubAccountRefString(42)).toBe(false)
  })
})
