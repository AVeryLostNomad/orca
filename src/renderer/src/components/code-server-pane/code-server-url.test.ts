import { describe, expect, it } from 'vitest'
import { buildCodeServerUrl, resolveWorkspaceFilePath } from './code-server-webview'

describe('buildCodeServerUrl', () => {
  it('opens the folder with an encoded path', () => {
    expect(buildCodeServerUrl(8080, '/repo/my worktree')).toBe(
      'http://127.0.0.1:8080/?folder=%2Frepo%2Fmy%20worktree'
    )
  })

  it('opens a workspace file via ?workspace= when one is given', () => {
    expect(buildCodeServerUrl(8080, '/repo/wt', '/repo/wt/my-app.code-workspace')).toBe(
      'http://127.0.0.1:8080/?workspace=%2Frepo%2Fwt%2Fmy-app.code-workspace'
    )
  })

  it('falls back to ?folder= when the workspace path is empty', () => {
    expect(buildCodeServerUrl(8080, '/repo/wt', '')).toBe(
      'http://127.0.0.1:8080/?folder=%2Frepo%2Fwt'
    )
  })
})

describe('resolveWorkspaceFilePath', () => {
  it('joins a relative workspace file onto the worktree folder (posix)', () => {
    expect(resolveWorkspaceFilePath('/repo/wt', 'my-app.code-workspace')).toBe(
      '/repo/wt/my-app.code-workspace'
    )
  })

  it('supports a nested relative path', () => {
    expect(resolveWorkspaceFilePath('/repo/wt', 'nested/my-app.code-workspace')).toBe(
      '/repo/wt/nested/my-app.code-workspace'
    )
  })

  it('normalizes a trailing folder separator and leading relative separators', () => {
    expect(resolveWorkspaceFilePath('/repo/wt/', '/leading.code-workspace')).toBe(
      '/repo/wt/leading.code-workspace'
    )
  })

  it('returns undefined for unset/blank settings', () => {
    expect(resolveWorkspaceFilePath('/repo/wt', undefined)).toBeUndefined()
    expect(resolveWorkspaceFilePath('/repo/wt', '   ')).toBeUndefined()
  })

  it('uses backslash separators for a Windows-style folder path', () => {
    expect(resolveWorkspaceFilePath('C:\\repo\\wt', 'a/b.code-workspace')).toBe(
      'C:\\repo\\wt\\a\\b.code-workspace'
    )
  })
})
