import { describe, expect, it } from 'vitest'
import {
  buildCodeServerUrl,
  normalizeCodeServerPathParam,
  resolveWorkspaceFilePath
} from './code-server-webview'

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

  it('normalizes a Windows drive folder into vscode-remote URI form (/C:/...)', () => {
    expect(buildCodeServerUrl(8080, 'C:\\Users\\joey\\wt')).toBe(
      'http://127.0.0.1:8080/?folder=%2FC%3A%2FUsers%2Fjoey%2Fwt'
    )
  })

  it('normalizes a Windows workspace file path too', () => {
    expect(buildCodeServerUrl(8080, 'C:\\repo\\wt', 'C:\\repo\\wt\\a.code-workspace')).toBe(
      'http://127.0.0.1:8080/?workspace=%2FC%3A%2Frepo%2Fwt%2Fa.code-workspace'
    )
  })

  it('normalizes a WSL UNC folder into forward-slash form', () => {
    expect(buildCodeServerUrl(8080, '\\\\wsl.localhost\\Ubuntu\\home\\joey\\wt')).toBe(
      'http://127.0.0.1:8080/?folder=%2F%2Fwsl.localhost%2FUbuntu%2Fhome%2Fjoey%2Fwt'
    )
  })
})

describe('normalizeCodeServerPathParam', () => {
  it('prefixes drive-letter paths with a slash and forward-slashes them', () => {
    expect(normalizeCodeServerPathParam('C:\\Users\\First Last\\wt')).toBe(
      '/C:/Users/First Last/wt'
    )
    expect(normalizeCodeServerPathParam('c:/already/forward')).toBe('/c:/already/forward')
  })

  it('forward-slashes UNC paths, including legacy \\\\wsl$ shares', () => {
    expect(normalizeCodeServerPathParam('\\\\wsl.localhost\\Ubuntu\\home\\u\\wt')).toBe(
      '//wsl.localhost/Ubuntu/home/u/wt'
    )
    expect(normalizeCodeServerPathParam('\\\\wsl$\\Ubuntu\\home\\u\\wt')).toBe(
      '//wsl$/Ubuntu/home/u/wt'
    )
  })

  it('leaves POSIX paths untouched and is idempotent', () => {
    expect(normalizeCodeServerPathParam('/repo/wt')).toBe('/repo/wt')
    expect(normalizeCodeServerPathParam('/C:/Users/joey/wt')).toBe('/C:/Users/joey/wt')
    expect(normalizeCodeServerPathParam('//wsl.localhost/Ubuntu/home')).toBe(
      '//wsl.localhost/Ubuntu/home'
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
