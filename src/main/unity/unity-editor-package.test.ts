import { describe, expect, it } from 'vitest'
import { compareUnityPackageVersions } from './unity-editor-package'

describe('compareUnityPackageVersions', () => {
  it('orders numerically, ranks releases above prereleases, and treats missing parts as zero', () => {
    expect(compareUnityPackageVersions('1.10.0', '1.9.3')).toBe(1)
    expect(compareUnityPackageVersions('1.0.0', '1.0.0-exp.2')).toBe(1)
    expect(compareUnityPackageVersions('1.0.0-exp.10', '1.0.0-exp.9')).toBe(1)
    expect(compareUnityPackageVersions('1.0', '1.0.0')).toBe(0)
    expect(compareUnityPackageVersions('0.9.9', '1.0.0-pre.1')).toBe(-1)
  })
})
